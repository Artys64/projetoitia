import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ConversationPage, MessagePage, SendResponse } from '@support-hub/contracts'
import type { Installation } from '../embed.js'
import { Database, type Sql } from './database.js'

export class ChatError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export type Session = { id: string; tenant_id: string; installation_id: string }
export const missing = () => new ChatError(404, 'not_found', 'Conversa não encontrada.')
export const limitError = () => new ChatError(429, 'usage_limit', 'Limite de uso atingido. Tente mais tarde.')
export const iso = (value: Date) => value.toISOString()
export class ChatStore {
  constructor(readonly db: Database, readonly sessionDays = 7, readonly sessionDailyLimit = 30, readonly sessionIssuanceLimit = 30) {}
  async installation(id: string): Promise<Installation | undefined> {
    const result = await this.db.pool.query(`SELECT i.*,t.active AS tenant_active FROM installations i JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1`, [id])
    const row = result.rows[0]
    return row && { installationId: row.id, companyId: row.tenant_id, name: row.name, greeting: row.greeting, color: row.color, allowedOrigins: row.allowed_origins, active: row.active && row.tenant_active }
  }
  async createSession(installationId: string, ip: string) {
    // Database-backed bucket applies across replicas. A failed attempt also consumes capacity.
    const key = digest(`${ip}:${Math.floor(Date.now()/3600000)}`)
    const rate = await this.db.pool.query(`INSERT INTO session_rate_buckets(key,expires_at) VALUES($1,now()+interval '2 hours') ON CONFLICT(key) DO UPDATE SET count=session_rate_buckets.count+1 RETURNING count`, [key])
    if (rate.rows[0].count > this.sessionIssuanceLimit) throw limitError()
    const installation = await this.installation(installationId)
    if (!installation) throw new ChatError(404,'installation_missing','Instalação não encontrada.')
    if (!installation.active) throw new ChatError(403,'installation_disabled','Instalação indisponível.')
    return this.db.transaction(installation.companyId, async sql => {
      const live = await sql.query('SELECT i.id FROM installations i JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1 AND i.active AND t.active FOR SHARE OF i,t', [installationId])
      if (!live.rowCount) throw new ChatError(403,'installation_disabled','Instalação indisponível.')
      const token = randomBytes(32).toString('base64url')
      const result = await sql.query(`INSERT INTO visitor_sessions(id,tenant_id,installation_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 day') RETURNING expires_at`,[randomUUID(),installation.companyId,installationId,digest(token),this.sessionDays])
      return { token, expiresAt: iso(result.rows[0].expires_at) }
    })
  }
  async authenticated<T>(token: string, work: (sql: Sql, session: Session) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ChatError(401,'session_expired','Sua sessão expirou. Inicie uma nova sessão.')
    const rateKey=digest(`request:${digest(token)}:${Math.floor(Date.now()/60000)}`)
    const rate=await this.db.pool.query(`INSERT INTO session_rate_buckets(key,expires_at) VALUES($1,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET count=session_rate_buckets.count+1 RETURNING count`,[rateKey])
    if(rate.rows[0].count>120)throw limitError()
    return this.db.transaction(null, async sql => {
      await sql.query("SELECT set_config('app.token_hash',$1,true)", [digest(token)])
      const found = await sql.query(`SELECT s.id,s.tenant_id,s.installation_id FROM visitor_sessions s JOIN installations i ON i.id=s.installation_id JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND i.active AND t.active`,[digest(token)])
      const session = found.rows[0] as Session | undefined
      if (!session) throw new ChatError(401,'session_expired','Sua sessão expirou ou a instalação está indisponível.')
      await sql.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.token_hash','',true)",[session.tenant_id])
      // Revalidate under row locks: revocation and installation changes cannot race a write.
      const valid = await sql.query(`SELECT s.id FROM visitor_sessions s JOIN installations i ON i.id=s.installation_id JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND i.active AND t.active `,[session.id])
      if (!valid.rowCount) throw new ChatError(401,'session_expired','Sua sessão expirou.')
      // Tenant first, then session, then conversation is the common write lock order.
      const tenant = await sql.query('SELECT id FROM tenants WHERE id=$1 AND active FOR UPDATE',[session.tenant_id])
      if (!tenant.rowCount) throw new ChatError(401,'session_expired','Instalação indisponível.')
      const locked = await sql.query('SELECT s.id FROM visitor_sessions s JOIN installations i ON i.id=s.installation_id WHERE s.id=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND i.active FOR UPDATE OF s FOR SHARE OF i',[session.id])
      if (!locked.rowCount) throw new ChatError(401,'session_expired','Sua sessão expirou.')
      return work(sql,session)
    })
  }
  /** Early HTTP guard. Mutations still revalidate under locks in authenticated(). */
  async authenticate(token: string): Promise<Session> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ChatError(401,'session_expired','Sua sessão expirou. Inicie uma nova sessão.')
    return this.db.transaction(null, async sql => {
      await sql.query("SELECT set_config('app.token_hash',$1,true)", [digest(token)])
      const result = await sql.query(`SELECT s.id,s.tenant_id,s.installation_id
        FROM visitor_sessions s JOIN installations i ON i.id=s.installation_id
        JOIN tenants t ON t.id=s.tenant_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
          AND i.active AND t.active`, [digest(token)])
      const session = result.rows[0] as Session | undefined
      if (!session) throw new ChatError(401,'session_expired','Sua sessão expirou ou a instalação está indisponível.')
      return session
    })
  }
  async revoke(token: string) { return this.authenticated(token, async (sql,s) => { await sql.query('UPDATE visitor_sessions SET revoked_at=now() WHERE id=$1',[s.id]); return { revoked: true } }) }
  async idempotent<T>(sql: Sql,s: Session,key: string,payload: unknown,work:()=>Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key)) throw new ChatError(400,'invalid_key','Envie uma chave de idempotência válida.')
    const hash = digest(JSON.stringify(payload))
    const previous = await sql.query('SELECT payload_hash,result FROM idempotency_keys WHERE tenant_id=$1 AND session_id=$2 AND key=$3',[s.tenant_id,s.id,key])
    if (previous.rowCount) {
      if (previous.rows[0].payload_hash !== hash) throw new ChatError(409,'idempotency_conflict','A chave já foi utilizada em outra operação.')
      return previous.rows[0].result as T
    }
    const result = await work()
    await sql.query('INSERT INTO idempotency_keys(tenant_id,session_id,key,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[s.tenant_id,s.id,key,hash,JSON.stringify(result)])
    return result
  }
  async conversation(sql: Sql,s: Session,id: string) {
    const found = await sql.query('SELECT * FROM conversations WHERE id=$1 AND tenant_id=$2 AND session_id=$3 FOR UPDATE',[id,s.tenant_id,s.id])
    if (!found.rowCount) throw missing()
    return found.rows[0]
  }
  async createConversation(token: string,key: string) {
    return this.authenticated(token, (sql,s) => this.idempotent(sql,s,key,['conversation'], async () => {
      const count = await sql.query('SELECT count(*)::int AS count FROM conversations WHERE session_id=$1',[s.id])
      if (count.rows[0].count >= 50) throw limitError()
      const result = await sql.query('INSERT INTO conversations(id,tenant_id,session_id) VALUES($1,$2,$3) RETURNING *',[randomUUID(),s.tenant_id,s.id])
      const row = result.rows[0]
      return { id: row.id, title: row.title, createdAt: iso(row.created_at) }
    }))
  }
  async conversations(token: string,before?: string,limit=20): Promise<ConversationPage> {
    return this.authenticated(token,async (sql,s)=>{
      if(before) await this.conversation(sql,s,before)
      const result = await sql.query(`SELECT id,title,created_at FROM conversations WHERE tenant_id=$1 AND session_id=$2 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM conversations WHERE id=$3)) ORDER BY created_at DESC,id DESC LIMIT $4`,[s.tenant_id,s.id,before ?? null,limit+1])
      const rows=result.rows.slice(0,limit)
      return {conversations:rows.map(row=>({id:row.id,title:row.title,createdAt:iso(row.created_at)})), nextCursor:result.rows.length>limit ? rows.at(-1)!.id:null}
    })
  }
  async messages(token:string,id:string,after=0,limit=50):Promise<MessagePage> {
    return this.authenticated(token,async(sql,s)=>{
      await this.conversation(sql,s,id)
      const result=await sql.query('SELECT * FROM messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',[id,after,limit+1])
      const runs=await sql.query('SELECT r.* FROM ai_runs r JOIN messages m ON m.id=r.message_id WHERE r.conversation_id=$1 ORDER BY m.sequence DESC LIMIT 1',[id])
      const r=runs.rows[0],rows=result.rows.slice(0,limit)
      return {messages:rows.map(m=>({id:m.id,sequence:m.sequence,role:m.role,content:m.content,createdAt:iso(m.created_at),sources:m.sources??[]})), nextCursor:result.rows.length>limit ? rows.at(-1)!.sequence:null,run:r?{id:r.id,state:r.state,errorCode:r.error_code,canRetry:r.state==='failed'&&r.attempts<3&&r.error_code!=='source_changed'}:null}
    })
  }
  async source(token:string,articleId:string,version:number) {
    return this.authenticated(token,async(sql,s)=>{
      const row=(await sql.query(`SELECT a.published_version,v.title,v.content FROM articles a
        JOIN article_versions v ON v.tenant_id=a.tenant_id AND v.article_id=a.id AND v.version=a.published_version
        WHERE a.tenant_id=$1 AND a.id=$2`,[s.tenant_id,articleId])).rows[0]
      if(!row) throw missing()
      return row.published_version===version
        ? {status:'current' as const,title:row.title,content:row.content,version:row.published_version}
        : {status:'updated' as const,title:row.title,content:null,version:row.published_version}
    })
  }
  async reserve(sql:Sql,s:Session) {
    const tenant=(await sql.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE',[s.tenant_id])).rows[0]
    const active=await sql.query("SELECT count(*)::int AS count FROM ai_runs WHERE state IN ('queued','running')")
    if(active.rows[0].count>=tenant.concurrent_run_limit) throw limitError()
    for(const [actor,limit] of [['tenant',tenant.daily_run_limit],[s.id,this.sessionDailyLimit]] as const) {
      const used=await sql.query(`INSERT INTO usage_buckets(tenant_id,actor,reserved_runs) VALUES($1,$2,1) ON CONFLICT(tenant_id,day,actor) DO UPDATE SET reserved_runs=usage_buckets.reserved_runs+1 RETURNING reserved_runs`,[s.tenant_id,actor])
      if(used.rows[0].reserved_runs>limit) throw limitError()
    }
  }
  async send(token:string,id:string,key:string,message:string):Promise<SendResponse> {
    return this.authenticated(token,(sql,s)=>this.idempotent(sql,s,key,['send',id,message],async()=>{
      const c=await this.conversation(sql,s,id)
      if(c.state!=='ai') throw new ChatError(409,'conversation_closed','Esta conversa não aceita novas mensagens.')
      const active=await sql.query("SELECT id FROM ai_runs WHERE conversation_id=$1 AND state IN ('queued','running')",[id])
      if(active.rowCount) throw new ChatError(409,'generation_pending','Aguarde a resposta antes de enviar outra mensagem.')
      await this.reserve(sql,s)
      const messageId=randomUUID(),runId=randomUUID()
      await sql.query('INSERT INTO messages(id,tenant_id,conversation_id,sequence,role,content) VALUES($1,$2,$3,$4,\'user\',$5)',[messageId,s.tenant_id,id,c.next_sequence,message])
      await sql.query('INSERT INTO ai_runs(id,tenant_id,conversation_id,message_id) VALUES($1,$2,$3,$4)',[runId,s.tenant_id,id,messageId])
      await sql.query('INSERT INTO jobs(id,tenant_id,run_id) VALUES($1,$2,$3)',[randomUUID(),s.tenant_id,runId])
      await sql.query('UPDATE conversations SET next_sequence=next_sequence+1,updated_at=now(),title=CASE WHEN next_sequence=1 THEN $2 ELSE title END WHERE id=$1',[id,message.slice(0,80)])
      return {messageId,runId}
    }))
  }
  async retry(token:string,id:string,runId:string,key:string) {
    return this.authenticated(token,(sql,s)=>this.idempotent(sql,s,key,['retry',id,runId],async()=>{
      const c=await this.conversation(sql,s,id)
      const result=await sql.query('SELECT * FROM ai_runs WHERE id=$1 AND conversation_id=$2 FOR UPDATE',[runId,id])
      const run=result.rows[0]
      if(!run) throw missing()
      const latest=(await sql.query('SELECT r.id FROM ai_runs r JOIN messages m ON m.id=r.message_id WHERE r.conversation_id=$1 ORDER BY m.sequence DESC LIMIT 1',[id])).rows[0]
      if(c.state!=='ai'||run.state!=='failed'||run.attempts>=3||run.error_code==='source_changed'||latest?.id!==runId) throw new ChatError(409,'retry_unavailable','Esta resposta não pode ser repetida. Envie uma nova pergunta.')
      await this.reserve(sql,s)
      await sql.query("UPDATE ai_runs SET state='queued',error_code=NULL,updated_at=now() WHERE id=$1",[runId])
      await sql.query('INSERT INTO jobs(id,tenant_id,run_id) VALUES($1,$2,$3)',[randomUUID(),s.tenant_id,runId])
      return {runId}
    }))
  }
}
