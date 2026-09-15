export type PublicInstallation = {
  chatEnabled?: boolean
  installationId: string
  companyId: string
  name: string
  greeting: string
  color: string
  allowedOrigins: string[]
}
export type Payloads = {
  init: { installationId: string }
  ready: { installationId: string }
  open: Record<string, never>
  close: Record<string, never>
  opened: Record<string, never>
  closed: { reason: 'command' | 'dismiss' }
  error: { code: string; message: string }
}
export type MessageType = keyof Payloads
export type Envelope<T extends MessageType = MessageType> = T extends MessageType ? {
  version: 1; type: T; requestId: string; instanceId: string; payload: Payloads[T]
} : never
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f]/.test(value)
export function isEnvelope(value: unknown): value is Envelope {
  if (!record(value) || Object.keys(value).length !== 5 || value.version !== 1 ||
    !identifier(value.instanceId) || !identifier(value.requestId) || !record(value.payload)) return false
  const payload = value.payload
  const keys = Object.keys(payload).sort().join(',')
  switch (value.type) {
    case 'init': case 'ready': return keys === 'installationId' && identifier(payload.installationId)
    case 'open': case 'close': case 'opened': return keys === ''
    case 'closed': return keys === 'reason' && (payload.reason === 'command' || payload.reason === 'dismiss')
    case 'error': return keys === 'code,message' && identifier(payload.code) && text(payload.message, 240)
    default: return false
  }
}
export function envelope<T extends MessageType>(type: T, instanceId: string, requestId: string, payload: Payloads[T]): Envelope<T> {
  return { version: 1, type, instanceId, requestId, payload } as Envelope<T>
}
export function isAllowedOrigin(value: unknown, allowLocal = false): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return !url.hostname.includes('*') && url.origin === value && !url.username && !url.password &&
      (url.protocol === 'https:' || (allowLocal && url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch { return false }
}
export function isPublicInstallation(value: unknown, allowLocal = false): value is PublicInstallation {
  if (!record(value)) return false
  return (value.chatEnabled === undefined || typeof value.chatEnabled === 'boolean') && identifier(value.installationId) && identifier(value.companyId) && text(value.name, 80) &&
    text(value.greeting, 240) && typeof value.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.color) &&
    Array.isArray(value.allowedOrigins) && value.allowedOrigins.length > 0 && value.allowedOrigins.length <= 20 &&
    value.allowedOrigins.every(origin => isAllowedOrigin(origin, allowLocal))
}
export * from './chat.js'
export * from './knowledge.js'
export type { SupportChatMessage, SupportChatRequest, SupportChatResponse } from './support-chat.js'
