import type { SupportChatMessage } from '@support-hub/contracts'

export function parseMessages(value: unknown): SupportChatMessage[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as { message?: unknown; messages?: unknown }
  if (Array.isArray(body.messages)) {
    const validMessages = body.messages.every((item) => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as { role?: unknown; content?: unknown }
      return (candidate.role === 'user' || candidate.role === 'assistant') &&
        typeof candidate.content === 'string' && candidate.content.trim().length > 0 &&
        // The UI sends assistant answers back, which can exceed the user input limit.
        candidate.content.length <= (candidate.role === 'assistant' ? 8000 : 500)
    })
    if (!validMessages || body.messages.length === 0) return null
    return body.messages.slice(-12).map(item => {
      const message = item as SupportChatMessage
      return { role: message.role, content: message.content.trim() }
    })
  }
  if (typeof body.message === 'string' && body.message.trim() && body.message.length <= 500) {
    return [{ role: 'user', content: body.message.trim() }]
  }
  return null
}
