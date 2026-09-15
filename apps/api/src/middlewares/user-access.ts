import type { FastifyInstance } from 'fastify'
import type { ChatStore } from '../db/store.js'
import { bearerToken } from './access.js'

export function installUserAccess(app: FastifyInstance, sessions: Pick<ChatStore, 'authenticate'>): void {
  app.decorateRequest('access', null)
  app.addHook('onRequest', async request => {
    const session = await sessions.authenticate(bearerToken(request))
    request.access = Object.freeze({
      role: 'user', companyId: session.tenant_id,
      sessionId: session.id, installationId: session.installation_id,
    })
  })
}
