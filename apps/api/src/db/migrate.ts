import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Database } from './database.js'

export async function migrate(db: Database) {
  const directory = new URL('../../migrations/', import.meta.url)
  const sql = await db.pool.connect()
  try {
    await sql.query("SELECT pg_advisory_lock(81852341)")
    await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, directory), 'utf8')
      const checksum = createHash('sha256').update(source).digest('hex')
      const applied = await sql.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Migração alterada: ${name}`)
        continue
      }
      await sql.query('BEGIN')
      try {
        await sql.query(source)
        await sql.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum])
        await sql.query('COMMIT')
      } catch (error) { await sql.query('ROLLBACK'); throw error }
    }
  } finally { await sql.query('SELECT pg_advisory_unlock(81852341)'); sql.release() }
}
