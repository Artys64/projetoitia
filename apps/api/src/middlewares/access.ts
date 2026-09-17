import type { FastifyRequest } from 'fastify'

export type UserAccess = Readonly<{
  role: 'user'
  companyId: string
  sessionId: string
  installationId: string
}>
export type AdminAccess = Readonly<{
  role: 'admin'
  companyId: string
  sessionId: string
  userId: string
  credentialHash: string
}>

declare module 'fastify' {
  interface FastifyRequest {
    access: UserAccess | AdminAccess | null
  }
}

export class AccessError extends Error {
  constructor(readonly statusCode: 401 | 403 | 429, readonly code: string, message: string) {
    super(message)
  }
}

export function bearerToken(request: FastifyRequest): string {
  return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1] ?? ''
}

export function requireUserAccess(request: FastifyRequest): UserAccess {
  if (request.access?.role !== 'user') throw new AccessError(401, 'session_expired', 'Inicie uma sessão de atendimento.')
  return request.access
}

export function requireAdminAccess(request: FastifyRequest): AdminAccess {
  if (request.access?.role !== 'admin') throw new AccessError(401, 'admin_session_required', 'Entre no painel administrativo.')
  return request.access
}
