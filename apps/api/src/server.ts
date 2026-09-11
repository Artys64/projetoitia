import { buildApp } from './app.js'

const app = buildApp()
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 3000)

async function shutdown(signal: NodeJS.Signals) {
  app.log.info({ signal }, 'Encerrando a API')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
