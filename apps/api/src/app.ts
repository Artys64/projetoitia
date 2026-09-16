import { Database } from './db/database.js'
import { createPostgresKnowledgeSearch } from './db/knowledge.js'
import { ChatStore } from './db/store.js'
import { registerWidgetRoutes } from './widget-routes.js'
import { registerAdminRoutes } from './admin-routes.js'
import { AdminSessionStore } from './db/admin-sessions.js'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerEmbed, type EmbedOptions } from './embed.js'
import { registerChat, type ChatOptions } from './ia/chat.js'
import { createEmbeddingProvider } from './ia/embeddings/local.js'
import type { EmbeddingProvider } from './ia/embeddings/provider.js'

type BuildAppOptions = EmbedOptions & ChatOptions & {
  sessionIssuanceLimit?: number
  database?: Database
  logger?: boolean
  adminOrigin?: string
  embeddingProvider?: EmbeddingProvider
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 3) throw new Error('TRUST_PROXY_HOPS inválido')
  const app = Fastify({ trustProxy: proxyHops ? (_address, hop) => hop < proxyHops : false, logger: options.logger === false ? false : { redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 131072, ajv: { customOptions: { removeAdditional: false } } })
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const database = options.database ?? (process.env.DATABASE_URL ? new Database(process.env.DATABASE_URL) : undefined)
  if (production && !database) throw new Error('DATABASE_URL obrigatória em produção')
  const store = database ? new ChatStore(database, 7, 30, options.sessionIssuanceLimit ?? 30) : undefined
  if (database) {
    app.addHook('onReady', () => database.ready())
    if (!options.database) app.addHook('onClose', () => database.close())
    registerWidgetRoutes(app, store!)
    registerAdminRoutes(app, new AdminSessionStore(database), {
      production,
      origin: options.adminOrigin ?? (process.env.ADMIN_ORIGIN?.trim() || undefined),
    })
  }
  registerEmbed(app, { ...options, ...(store ? { installationLookup: id => store.installation(id) } : {}) })
  if (!production) registerChat(app, {
    ...(database ? { knowledgeSearch: createPostgresKnowledgeSearch(
      database, options.embeddingProvider ?? createEmbeddingProvider(),
    ) } : {}),
    ...options,
  })

  app.get('/api/health', async (_request,reply) => {
    if (database) {
      try { await database.pool.query('SELECT 1 FROM tenants LIMIT 1') }
      catch { return reply.code(503).send({status:'unavailable',service:'support-hub-api'}) }
    }
    return ({
    status: 'ok' as const,
    service: 'support-hub-api',
    timestamp: new Date().toISOString(),
  }) })

  return app
}
