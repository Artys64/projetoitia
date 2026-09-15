import { isPublicInstallation } from '@support-hub/contracts'
import type { Installation } from '../embed.js'
import { validateArticles } from '../ia/knowledge/repository.js'
import { Database } from './database.js'
import { digest } from './store.js'
import { randomBytes, randomUUID } from 'node:crypto'
export async function importInstallation(db:Database,installation:Installation,production=true) {
  if(!isPublicInstallation(installation,!production)||typeof installation.active!=='boolean') throw new Error('Instalação inválida; use origens HTTPS exatas em produção')
  await db.transaction(installation.companyId,async sql=>{
    await sql.query('INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[installation.companyId,installation.name])
    await sql.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[installation.companyId])
    const previous=(await sql.query('SELECT tenant_id FROM installations WHERE id=$1',[installation.installationId])).rows[0]
    if(previous&&previous.tenant_id!==installation.companyId) throw new Error('Instalação não pode mudar de empresa')
    await sql.query(`INSERT INTO installations(id,tenant_id,name,greeting,color,allowed_origins,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,greeting=excluded.greeting,color=excluded.color,allowed_origins=excluded.allowed_origins,active=excluded.active`,[installation.installationId,installation.companyId,installation.name,installation.greeting,installation.color,JSON.stringify(installation.allowedOrigins),installation.active])
  })
}
export async function importArticles(db:Database,value:unknown) {
  const articles=validateArticles(value)
  for(const tenant of [...new Set(articles.map(a=>a.companyId))]) await db.transaction(tenant,async sql=>{
    const exists=await sql.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant])
    if(!exists.rowCount) throw new Error(`Cadastre a empresa antes dos artigos: ${tenant}`)
    for(const a of articles.filter(a=>a.companyId===tenant)) {
      await sql.query('INSERT INTO articles(tenant_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING',[tenant,a.id])
      const previous=(await sql.query('SELECT * FROM article_versions WHERE tenant_id=$1 AND article_id=$2 AND version=$3',[tenant,a.id,a.version])).rows[0]
      if(previous&&(previous.title!==a.title||previous.content!==a.content||JSON.stringify(previous.keywords)!==JSON.stringify(a.keywords)||JSON.stringify(previous.suggestions)!==JSON.stringify(a.suggestions))) throw new Error(`Versão imutável: incremente version de ${a.id}`)
      await sql.query('INSERT INTO article_versions(tenant_id,article_id,version,title,content,keywords,suggestions) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[tenant,a.id,a.version,a.title,a.content,JSON.stringify(a.keywords),JSON.stringify(a.suggestions)])
      await sql.query('UPDATE articles SET published_version=$3 WHERE tenant_id=$1 AND id=$2',[tenant,a.id,a.status==='published'?a.version:null])
    }
  })
  return articles.length
}

/** Creates a revocable first-party admin session for a single tenant. */
export async function issueAdminSession(db: Database, tenantId: string, days = 7) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId)) throw new Error('Empresa inválida')
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Validade deve ficar entre 1 e 30 dias')
  const token = randomBytes(32).toString('base64url')
  const userId = randomUUID()
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + days * 86_400_000)
  await db.transaction(tenantId, async sql => {
    if (!(await sql.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])).rowCount) {
      throw new Error(`Empresa não encontrada: ${tenantId}`)
    }
    await sql.query('INSERT INTO admin_users(id) VALUES($1)', [userId])
    await sql.query('INSERT INTO admin_memberships(tenant_id,user_id) VALUES($1,$2)', [tenantId, userId])
    await sql.query(`
      INSERT INTO admin_sessions(id,tenant_id,user_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5)
    `, [sessionId, tenantId, userId, digest(token), expiresAt])
  })
  return { token, expiresAt: expiresAt.toISOString(), userId }
}
// Password comes from environment and never from shell arguments. Fixed role name avoids SQL identifiers from user input.
export async function provisionRuntime(db:Database,password:string) {
  if(password.length<20) throw new Error('APP_DATABASE_PASSWORD precisa de pelo menos 20 caracteres')
  await db.pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='support_hub_app') THEN CREATE ROLE support_hub_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$`)
  // quote_literal is used by the server to preserve arbitrary password bytes, including backslashes.
  const quoted=(await db.pool.query('SELECT quote_literal($1) AS value',[password])).rows[0].value as string
  await db.pool.query(`ALTER ROLE support_hub_app PASSWORD ${quoted}`)
  await db.pool.query('GRANT USAGE ON SCHEMA public TO support_hub_app')
  await db.pool.query('GRANT SELECT ON tenants,installations TO support_hub_app')
  await db.pool.query('GRANT UPDATE(name) ON tenants,installations TO support_hub_app')
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON visitor_sessions,conversations,messages,ai_runs,jobs,idempotency_keys,usage_buckets,session_rate_buckets TO support_hub_app')
  await db.pool.query('GRANT SELECT,INSERT,UPDATE ON ai_run_attempts TO support_hub_app')
  await db.pool.query('GRANT SELECT ON articles,article_versions TO support_hub_app')
  await db.pool.query('GRANT SELECT ON admin_users,admin_memberships,admin_sessions TO support_hub_app')
  await db.pool.query('GRANT UPDATE(revoked_at) ON admin_sessions TO support_hub_app')
  await db.pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON article_drafts TO support_hub_app')
  await db.pool.query('GRANT INSERT ON articles,article_versions TO support_hub_app')
  await db.pool.query('GRANT UPDATE(published_version) ON articles TO support_hub_app')
  await db.pool.query('GRANT UPDATE(id) ON articles TO support_hub_app')
}
