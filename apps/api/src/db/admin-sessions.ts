import { AccessError, type AdminAccess } from '../middlewares/access.js'
import { digest } from './store.js'
import type { Database, Sql } from './database.js'

/** Session issuance belongs to the login flow; the HTTP runtime only reads these tables. */
export class AdminSessionStore {
  constructor(readonly db: Database) {}

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
