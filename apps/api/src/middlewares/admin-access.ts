import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isAllowedOrigin } from '@support-hub/contracts'
import type { AdminSessionStore } from '../db/admin-sessions.js'
import { AccessError } from './access.js'

export function adminCookieName(production: boolean): string {
  return production ? '__Host-support_hub_admin' : 'support_hub_admin'
}

export function validateAdminOrigin(options: { production: boolean; origin?: string }): void {
  if (options.origin !== undefined && !isAllowedOrigin(options.origin, !options.production)) {
    throw new Error('ADMIN_ORIGIN deve ser uma origem HTTPS exata (HTTP local apenas em desenvolvimento)')
  }
}

export function requireAdminWriteOrigin(
  request: FastifyRequest,
  options: { origin?: string },
): void {
  if (!options.origin || request.headers.origin !== options.origin) {
    throw new AccessError(403, 'invalid_origin', 'Origem não autorizada para esta operação.')
  }
}

// Only one opaque base64url credential is accepted; ambiguous duplicate cookies fail closed.
function adminToken(request: FastifyRequest, name: string): string {
  const values = (request.headers.cookie ?? '').split(';').map(part => part.trim())
    .filter(part => part.includes('=') && part.slice(0, part.indexOf('=')).trim() === name)
  if (values.length !== 1) return ''
  const value = values[0]!.slice(values[0]!.indexOf('=') + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}

export function installAdminAccess(
  app: FastifyInstance,
  sessions: Pick<AdminSessionStore, 'authenticate'>,
  options: { production: boolean; origin?: string },
): void {
  validateAdminOrigin(options)
  app.decorateRequest('access', null)
  app.addHook('onRequest', async request => {
    request.access = Object.freeze(await sessions.authenticate(adminToken(request, adminCookieName(options.production))))
    // Cookie-authenticated writes require an explicitly configured browser origin.
    // Never derive trust from Host/X-Forwarded-Host, body, query or Referer.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) requireAdminWriteOrigin(request, options)
  })
}
