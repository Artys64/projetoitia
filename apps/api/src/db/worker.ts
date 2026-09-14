import { randomUUID } from 'node:crypto'
import { groq } from '@ai-sdk/groq'
import { generateNoraResponse } from '../ia/agents/nora.js'
import { PROMPT_VERSION } from '../ia/prompts/nora.js'
import { createTextSearch, type KnowledgeSearch } from '../ia/knowledge/search.js'
import type { Article } from '../ia/knowledge/repository.js'
import { Database, type Sql } from './database.js'

export type Generation = Awaited<ReturnType<typeof generateNoraResponse>>
export type Generate = (input: { messages: {role:'user'|'assistant';content:string}[]; search:KnowledgeSearch; companyId:string }) => Promise<Generation>
export type Claim = { tenantId:string; runId:string; conversationId:string; leaseToken:string; attempt:number }
const LEASE_SECONDS=60

export class ChatWorker {
  private nextTenant=0
  constructor(readonly db:Database, readonly generate:Generate = input=>generateNoraResponse({...input,model:groq(process.env.GROQ_MODEL?.trim()||'openai/gpt-oss-20b')})) {}
  async claim():Promise<Claim|null> {
    const tenants=(await this.db.pool.query('SELECT id FROM tenants ORDER BY id')).rows
    for(let i=0;i<tenants.length;i++) {
      const tenantId=tenants[(this.nextTenant+i)%tenants.length]!.id as string
      const claim=await this.db.transaction(tenantId,async sql=>{
        // Common lock order with the API: tenant, conversation, run/job.
        const tenant=(await sql.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE',[tenantId])).rows[0]
        const found=await sql.query(`SELECT j.*,r.conversation_id,r.attempts,r.state,c.session_id FROM jobs j JOIN ai_runs r ON r.id=j.run_id JOIN conversations c ON c.id=r.conversation_id WHERE j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp()) ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)
        const job=found.rows[0]
        if(!job) return null
        const authorization=await sql.query(`SELECT c.id FROM conversations c JOIN visitor_sessions s ON s.id=c.session_id JOIN installations i ON i.id=s.installation_id WHERE c.id=$1 AND c.state='ai' AND s.revoked_at IS NULL AND s.expires_at>now() AND i.active`,[job.conversation_id])
        if(!authorization.rowCount){await this.fail(sql,job.run_id,'conversation_unavailable');return null}
        if(!tenant.active || job.attempts>=3) { await this.fail(sql,job.run_id,'attempt_limit'); return null }
        if(job.state==='running') {
          // A recovered lease may call the provider again and consumes another reservation.
          for(const [actor,limit] of [['tenant',tenant.daily_run_limit],[job.session_id,30]]) {
            const usage=await sql.query(`INSERT INTO usage_buckets(tenant_id,actor,reserved_runs) VALUES($1,$2,1) ON CONFLICT(tenant_id,day,actor) DO UPDATE SET reserved_runs=usage_buckets.reserved_runs+1 RETURNING reserved_runs`,[tenantId,actor])
            if(usage.rows[0].reserved_runs>Number(limit)) {await this.fail(sql,job.run_id,'usage_limit');return null}
          }
        }
        const leaseToken=randomUUID()
        await sql.query(`UPDATE jobs SET lease_token=$2,lease_until=clock_timestamp()+$3*interval '1 second' WHERE id=$1`,[job.id,leaseToken,LEASE_SECONDS])
        await sql.query("UPDATE ai_runs SET state='running',attempts=attempts+1,updated_at=now() WHERE id=$1",[job.run_id])
        return {tenantId,runId:job.run_id,conversationId:job.conversation_id,leaseToken,attempt:job.attempts+1}
      })
      if(claim) {this.nextTenant=(this.nextTenant+i+1)%tenants.length;return claim}
    }
    return null
  }
  private async fail(sql:Sql,runId:string,code:string) {
    await sql.query("UPDATE ai_runs SET state='failed',error_code=$2,updated_at=now() WHERE id=$1",[runId,code])
    await sql.query('DELETE FROM jobs WHERE run_id=$1',[runId])
  }
  private async owned(sql:Sql,claim:Claim) {
    return (await sql.query(`SELECT r.id FROM ai_runs r JOIN jobs j ON j.run_id=r.id WHERE r.id=$1 AND r.state='running' AND r.attempts=$2 AND j.lease_token=$3 AND j.lease_until>clock_timestamp() FOR UPDATE OF r,j`,[claim.runId,claim.attempt,claim.leaseToken])).rowCount!==0
  }
  search:KnowledgeSearch=async(query,tenantId)=>this.db.transaction(tenantId,async sql=>{
    const rows=(await sql.query(`SELECT a.id,a.tenant_id,v.* FROM articles a JOIN article_versions v ON v.tenant_id=a.tenant_id AND v.article_id=a.id AND v.version=a.published_version WHERE a.tenant_id=$1`,[tenantId])).rows
    const articles:Article[]=rows.map(r=>({id:r.id,companyId:r.tenant_id,version:r.version,status:'published',title:r.title,content:r.content,keywords:r.keywords,suggestions:r.suggestions}))
    return createTextSearch(articles)(query,tenantId)
  })
  async execute(claim:Claim) {
    const started=Date.now()
    try {
      const messages=await this.db.transaction(claim.tenantId,async sql=>{
        const rows=(await sql.query(`SELECT role,content FROM messages WHERE conversation_id=$1 AND sequence<=(SELECT m.sequence FROM messages m JOIN ai_runs r ON r.message_id=m.id WHERE r.id=$2) ORDER BY sequence DESC LIMIT 12`,[claim.conversationId,claim.runId])).rows
        return rows.reverse() as {role:'user'|'assistant';content:string}[]
      })
      const result=await this.generate({messages,search:this.search,companyId:claim.tenantId})
      if(!result.text.trim()||result.text.length>8000) throw new Error('invalid_output')
      await this.db.transaction(claim.tenantId,async sql=>{
        const tenant=(await sql.query('SELECT active FROM tenants WHERE id=$1 FOR UPDATE',[claim.tenantId])).rows[0]
        const c=(await sql.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE',[claim.conversationId])).rows[0]
        if(!await this.owned(sql,claim)) return
        const sources=result.sources.map(({articleId,version,chunk})=>({articleId,version,chunk}))
        await sql.query('UPDATE ai_runs SET model=$2,prompt_version=$3,sources=$4,usage=$5,duration_ms=$6 WHERE id=$1',[claim.runId,result.model,PROMPT_VERSION,JSON.stringify(sources),JSON.stringify(result.usage),Date.now()-started])
        const session=(await sql.query(`SELECT s.id FROM visitor_sessions s JOIN installations i ON i.id=s.installation_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND i.active FOR SHARE OF s,i`,[c.session_id])).rows[0]
        if(!tenant.active||c.state!=='ai'||!session) { await this.fail(sql,claim.runId,'conversation_unavailable');return }
        for(const source of result.sources) {
          const found=await sql.query('SELECT published_version FROM articles WHERE tenant_id=$1 AND id=$2 FOR SHARE',[claim.tenantId,source.articleId])
          if(found.rows[0]?.published_version!==source.version) {await this.fail(sql,claim.runId,'source_changed');return}
        }
        await sql.query(`INSERT INTO messages(id,tenant_id,conversation_id,sequence,role,content,ai_run_id) VALUES($1,$2,$3,$4,'assistant',$5,$6)`,[randomUUID(),claim.tenantId,claim.conversationId,c.next_sequence,result.text,claim.runId])
        await sql.query('UPDATE conversations SET next_sequence=next_sequence+1,updated_at=now() WHERE id=$1',[claim.conversationId])
        await sql.query("UPDATE ai_runs SET state='completed',error_code=NULL,updated_at=now() WHERE id=$1",[claim.runId])
        await sql.query('DELETE FROM jobs WHERE run_id=$1',[claim.runId])
      })
      console.info(JSON.stringify({event:'ai_attempt_finished',tenantId:claim.tenantId,runId:claim.runId,attempt:claim.attempt,durationMs:Date.now()-started}))
    } catch {
      await this.db.transaction(claim.tenantId,async sql=>{
        await sql.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[claim.tenantId])
        if(await this.owned(sql,claim)) {
          await this.fail(sql,claim.runId,'generation_failed')
          await sql.query('UPDATE ai_runs SET duration_ms=$2,prompt_version=$3 WHERE id=$1',[claim.runId,Date.now()-started,PROMPT_VERSION])
        }
      })
      console.error(JSON.stringify({event:'ai_attempt_failed',tenantId:claim.tenantId,runId:claim.runId,attempt:claim.attempt}))
    }
  }
  async tick() {const claim=await this.claim();if(!claim)return false;await this.execute(claim);return true}
}
