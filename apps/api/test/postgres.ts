import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const image = 'pgvector/pgvector:0.8.6-pg18-trixie'

export async function localPostgres(_directory: string, port: number) {
  const name = `support-hub-pgvector-${process.pid}-${Math.random().toString(16).slice(2)}`
  await exec('docker', ['run', '-d', '--name', name,
    '-e', 'POSTGRES_PASSWORD=local_admin_password',
    '-p', `127.0.0.1:${port}:5432`, image])
  const ready = async () => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try {
        await exec('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'])
        return
      } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    throw new Error('PostgreSQL pgvector startup timeout')
  }
  await ready()
  return {
    async start() { await exec('docker', ['start', name]); await ready() },
    async stop() { await exec('docker', ['stop', '-t', '10', name]) },
    async destroy() { await exec('docker', ['rm', '-f', name]).catch(() => undefined) },
  }
}
