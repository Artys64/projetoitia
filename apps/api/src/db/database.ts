import pg, { type PoolClient } from 'pg'
export type Sql = PoolClient
export class Database {
  readonly pool: pg.Pool
  constructor(url: string, max = 8) {
    this.pool = new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
    this.pool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })))
  }
  async transaction<T>(tenant: string | null, work: (sql: Sql) => Promise<T>): Promise<T> {
    const sql = await this.pool.connect()
    try {
      await sql.query('BEGIN')
      await sql.query("SELECT set_config('app.admin_username','',true)")
      await sql.query("SELECT set_config('app.tenant_id',$1,true), set_config('app.token_hash','',true), set_config('app.admin_token_hash','',true), set_config('app.admin_user_id','',true), set_config('TimeZone','UTC',true), set_config('statement_timeout','10000',true), set_config('lock_timeout','5000',true)", [tenant ?? ''])
      const result = await work(sql)
      await sql.query('COMMIT')
      return result
    } catch (error) { await sql.query('ROLLBACK'); throw error }
    finally { sql.release() }
  }
  async ready() {
    const result = await this.pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    if (result.rows[0]?.rolsuper || result.rows[0]?.rolbypassrls) throw new Error('DATABASE_URL deve usar papel sem SUPERUSER/BYPASSRLS')
    await this.pool.query('SELECT id FROM tenants LIMIT 1')
  }
  close() { return this.pool.end() }
}
