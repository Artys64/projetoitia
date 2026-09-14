/** Contratos do chat síncrono do painel em /api/chat. */
export type SupportChatMessage = { role: 'user' | 'assistant'; content: string }
export type SupportChatRequest = { message: string } | { messages: SupportChatMessage[] }
export type SupportChatResponse = { reply: string; suggestions: string[] }
