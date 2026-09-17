import { AccessError, type AdminAccess } from '../middlewares/access.js'
import { digest } from './store.js'
import type { Database, Sql } from './database.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { normalizeAdminUsername, verifyAdminPassword } from './admin-password.js'

export class AdminSessionStore {
  constructor(readonly db: Database) {}

  async checkLoginRate(ip: string): Promise<void> {
    const key = digest(`admin-login:${ip}:${Math.floor(Date.now() / 900_000)}`)
    const result = await this.db.pool.query(`INSERT INTO session_rate_buckets(key,expires_at)
      VALUES($1,now()+interval '30 minutes') ON CONFLICT(key)
      DO UPDATE SET count=session_rate_buckets.count+1 RETURNING count`, [key])
    if (result.rows[0].count > 10) {
      throw new AccessError(429, 'login_rate_limited', 'Muitas tentativas. Aguarde 15 minutos e tente novamente.')
    }
  }

  async login(username: string, password: string): Promise<{ token: string; access: AdminAccess }> {
    const token = randomBytes(32).toString('base64url')
    const access = await this.db.transaction(null, async sql => {
      await sql.query("SELECT set_config('app.admin_username',$1,true)", [normalizeAdminUsername(username)])
      const account = (await sql.query('SELECT * FROM admin_credentials WHERE username=$1',
        [normalizeAdminUsername(username)])).rows[0]
      const valid = await verifyAdminPassword(password, account?.password_hash)
      const denied = () => new AccessError(401, 'invalid_credentials', 'Usuário ou senha inválidos.')
      if (!valid || !account) throw denied()
      const credentialHash = digest(token)
      await sql.query("SELECT set_config('app.tenant_id',$1,true), set_config('app.admin_user_id',$2,true), set_config('app.admin_token_hash',$3,true)",
        [account.tenant_id, account.user_id, credentialHash])
      const authorized = await sql.query(`SELECT m.user_id FROM admin_memberships m
        JOIN admin_users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id
        WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.active AND u.active AND t.active`,
      [account.user_id, account.tenant_id])
      if (!authorized.rowCount) throw denied()
      const sessionId = randomUUID()
      await sql.query(`INSERT INTO admin_sessions(id,tenant_id,user_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '7 days')`, [sessionId, account.tenant_id, account.user_id, credentialHash])
      return { role: 'admin' as const, companyId: account.tenant_id, userId: account.user_id, sessionId, credentialHash }
    })
    return { token, access }
  }

  async authenticate(token: string): Promise<AdminAccess> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AccessError(401, 'admin_session_required', 'Entre no painel administrativo.')
    }
    const credentialHash = digest(token)
    return this.db.transaction(null, async sql => {
      await sql.query("SELECT set_config('app.admin_token_hash',$1,true)", [credentialHash])
      const session = (await sql.query(`
        SELECT id, tenant_id, user_id FROM admin_sessions
        WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
      `, [credentialHash])).rows[0]
      if (!session) throw new AccessError(401, 'admin_session_expired', 'Sua sessão administrativa expirou.')

      await sql.query("SELECT set_config('app.tenant_id',$1,true), set_config('app.admin_user_id',$2,true)",
        [session.tenant_id, session.user_id])
      const authorized = await sql.query(`
        SELECT s.id FROM admin_sessions s
        JOIN admin_users u ON u.id=s.user_id
        JOIN admin_memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
        JOIN tenants t ON t.id=s.tenant_id
        WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
          AND u.active AND m.active AND t.active
      `, [session.id])
      if (!authorized.rowCount) throw new AccessError(403, 'admin_access_denied', 'Acesso administrativo indisponível para esta empresa.')
      return { role: 'admin', companyId: session.tenant_id, sessionId: session.id, userId: session.user_id, credentialHash }
    })
  }

  /** Rechecks session and membership in the same transaction as editorial work. */
  async authorized<T>(access: AdminAccess, work: (sql: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(access.companyId, async sql => {
      await sql.query("SELECT set_config('app.admin_token_hash',$1,true), set_config('app.admin_user_id',$2,true)",
        [access.credentialHash, access.userId])
      const authorized = await sql.query(`
        SELECT s.id FROM admin_sessions s
        JOIN admin_users u ON u.id=s.user_id
        JOIN admin_memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
        JOIN tenants t ON t.id=s.tenant_id
        WHERE s.id=$1 AND s.tenant_id=$2 AND s.user_id=$3 AND s.token_hash=$4
          AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
          AND u.active AND m.active AND t.active
      `, [access.sessionId, access.companyId, access.userId, access.credentialHash])
      if (!authorized.rowCount) {
        throw new AccessError(403, 'admin_access_denied', 'Seu acesso a esta empresa foi removido.')
      }
      return work(sql)
    })
  }

  async revoke(access: AdminAccess): Promise<void> {
    await this.authorized(access, async sql => {
      await sql.query('UPDATE admin_sessions SET revoked_at=now() WHERE id=$1', [access.sessionId])
    })
  }
}
