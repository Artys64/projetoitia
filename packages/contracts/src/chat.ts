export type Conversation = { id: string; title: string; createdAt: string }
export type ChatSource = { articleId: string; title: string; version: number; chunk: number }
export type ChatMessage = { id: string; sequence: number; role: 'user' | 'assistant'; content: string; createdAt: string; sources: ChatSource[] }
export type KnowledgeSourceResponse = { status: 'current' | 'updated'; title: string; content: string | null; version: number }
export type AiRun = { id: string; state: 'queued' | 'running' | 'completed' | 'failed'; errorCode: string | null; canRetry: boolean }
export type MessagePage = { messages: ChatMessage[]; nextCursor: number | null; run: AiRun | null }
export type ConversationPage = { conversations: Conversation[]; nextCursor: string | null }
export type SessionResponse = { token: string; expiresAt: string }
export type SendResponse = { messageId: string; runId: string }
export type ApiError = { code: string; error: string }
export const chatSchemas = {
  session: { type: 'object', additionalProperties: false, required: ['installationId'], properties: { installationId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' } } },
  message: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } } },
  empty: { type: 'object', additionalProperties: false, properties: {} },
  id: { type: 'string', format: 'uuid' },
  articleId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' },
  sourceQuery: { type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } },
  messageQuery: { type: 'object', additionalProperties: false, properties: { after: { type: 'integer', minimum: 0, maximum: 2147483647 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
  conversationQuery: { type: 'object', additionalProperties: false, properties: { before: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
} as const
