import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { Database } from '../apps/api/src/db/database.js'
import { prepareDemo } from '../apps/api/src/db/demo.js'

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('npm run demo é exclusivo de desenvolvimento.')
  const required = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'GROQ_API_KEY'] as const
  const missing = required.filter(key => !process.env[key]?.trim())
  if (missing.length) throw new Error(`Configure ${missing.join(', ')} em apps/api/.env.local. Consulte docs/operacao-chat-persistente.md. Para somente visualizar o widget sem chat, use npm run demo:visual.`)

  // Refuse to show a different API that was already running on the demo ports.
  for (const port of [3000, 4174]) {
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', () => reject(new Error(`Porta ${port} indisponível. Encerre o dev/demo anterior e execute npm run demo novamente.`)))
      probe.listen(port, '0.0.0.0', () => probe.close(error => error ? reject(error) : resolve()))
    })
  }

  const runtime = new Database(process.env.DATABASE_URL!)
  const admin = new Database(process.env.MIGRATION_DATABASE_URL!)
  try {
    await runtime.ready()
    // prepareDemo checks every migration, including constraints used when publishing replies.
    await prepareDemo(admin)
  } catch {
    throw new Error('Não foi possível preparar o banco da demonstração. Confira as conexões e execute npm run db -- migrate e npm run db -- provision. As instalações inst_demo_a e inst_demo_b precisam pertencer a company_a e company_b.')
  } finally {
    await Promise.all([runtime.close(), admin.close()])
  }

  console.info('Chat real com Groq; mensagens salvas no PostgreSQL. As duas empresas usam artigos fictícios de demonstração.')
  console.info('Abra http://localhost:4174 → Mensagens → Nova conversa. Pergunte: Qual é o horário de atendimento?')
  const child = spawn(process.execPath, [
    'node_modules/concurrently/dist/bin/concurrently.js', '-k', '-n', 'api,worker,host',
    'node apps/api/dist/server.js', 'node apps/worker/dist/index.js', 'node apps/demo-host/server.mjs',
  ], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000', TRUST_PROXY_HOPS: '0' },
  })
  const stop = (signal: NodeJS.Signals) => { child.kill(signal) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1)))
    })
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha ao iniciar demonstração.')
  process.exitCode = 1
})
