import type { FastifyInstance } from 'fastify'
import { knowledgeSchemas, type KnowledgeUpdate, type KnowledgeWrite } from '@support-hub/contracts'
import { AccessError, requireAdminAccess } from './middlewares/access.js'
import {
  adminCookieName,
  installAdminAccess,
  requireAdminWriteOrigin,
  validateAdminOrigin,
} from './middlewares/admin-access.js'
import type { AdminSessionStore } from './db/admin-sessions.js'
import { AdminKnowledgeStore, KnowledgeError } from './db/admin-knowledge.js'

export function registerAdminRoutes(
  app: FastifyInstance,
  sessions: AdminSessionStore,
  options: { production: boolean; origin?: string },
): void {
  validateAdminOrigin(options)
  const knowledge = new AdminKnowledgeStore(sessions)
  app.register(async api => {
    api.addHook('onRequest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
    })
    api.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
      if (error instanceof AccessError) return reply.code(error.statusCode).send({ code: error.code, error: error.message })
      if (error instanceof KnowledgeError) return reply.code(error.status).send({ code: error.code, error: error.message })
      if (error.statusCode === 413) return reply.code(413).send({ code: 'document_too_large', error: 'O documento deve ter no máximo 1 MiB.' })
      if (error.validation) return reply.code(400).send({ code: 'invalid_request', error: 'Solicitação inválida.' })
      request.log.error({ event: 'admin_request_failed', requestId: request.id }, 'Falha no acesso administrativo')
      return reply.code(503).send({ code: 'unavailable', error: 'Serviço temporariamente indisponível.' })
    })

    api.post<{ Body: { token: string } }>('/login', {
      schema: {
        body: {
          type: 'object', additionalProperties: false, required: ['token'],
          properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
        },
      },
    }, async (request, reply) => {
      requireAdminWriteOrigin(request, options)
      const access = await sessions.authenticate(request.body.token)
      const cookie = [
        `${adminCookieName(options.production)}=${request.body.token}`,
        'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=604800',
        ...(options.production ? ['Secure'] : []),
      ].join('; ')
      reply.header('Set-Cookie', cookie)
      return { role: access.role, companyId: access.companyId, userId: access.userId }
    })

    api.register(async protectedApi => {
      installAdminAccess(protectedApi, sessions, options)

      protectedApi.get('/session', {
        schema: { querystring: knowledgeSchemas.empty },
      }, async request => {
        const { role, companyId, userId } = requireAdminAccess(request)
        return { role, companyId, userId }
      })

      protectedApi.delete('/session', async (request, reply) => {
        await sessions.revoke(requireAdminAccess(request))
        reply.header('Set-Cookie', [
          `${adminCookieName(options.production)}=`, 'Path=/', 'HttpOnly',
          'SameSite=Strict', 'Max-Age=0', ...(options.production ? ['Secure'] : []),
        ].join('; '))
        return reply.code(204).send()
      })

      protectedApi.get('/knowledge', {
        schema: { querystring: knowledgeSchemas.empty },
      }, async request => ({ items: await knowledge.list(requireAdminAccess(request)) }))

      protectedApi.post<{ Body: KnowledgeWrite }>('/knowledge', {
        bodyLimit: 1_100_000,
        schema: { body: knowledgeSchemas.create },
      }, async (request, reply) => reply.code(201).send(
        await knowledge.create(requireAdminAccess(request), request.body),
      ))

      protectedApi.put<{ Params: { id: string }; Body: KnowledgeUpdate }>('/knowledge/:id', {
        bodyLimit: 1_100_000,
        schema: { params: knowledgeSchemas.params, body: knowledgeSchemas.update },
      }, async request => knowledge.update(requireAdminAccess(request), request.params.id, request.body))

      protectedApi.post<{ Params: { id: string }; Body: { expectedRevision: number } }>('/knowledge/:id/publish', {
        schema: { params: knowledgeSchemas.params, body: knowledgeSchemas.publish },
      }, async request => knowledge.publish(
        requireAdminAccess(request), request.params.id, request.body.expectedRevision,
      ))

      protectedApi.post<{ Params: { id: string } }>('/knowledge/:id/unpublish', {
        schema: { params: knowledgeSchemas.params, body: knowledgeSchemas.empty },
      }, async request => knowledge.unpublish(requireAdminAccess(request), request.params.id))
    })
  }, { prefix: '/api/admin' })
}
