import type { FastifyInstance } from 'fastify'
import type { SupportChatRequest, SupportChatResponse } from '@support-hub/contracts'
import { KnowledgeSearchError } from './agents/nora.js'
import { createChatService, GenerationResponseError, type ChatOptions } from './service.js'
import { parseMessages } from './validation.js'

export type { ChatOptions } from './service.js'

export function registerChat(app: FastifyInstance, options: ChatOptions = {}): void {
  const service = createChatService(options)

  app.post<{ Body: SupportChatRequest; Reply: SupportChatResponse | { error: string } }>('/api/chat', async (request, reply) => {
    const messages = parseMessages(request.body)
    if (!messages) {
      return reply.code(400).send({ error: 'Envie uma conversa válida com mensagens de usuário de até 500 caracteres.' })
    }
    if (!messages.some(message => message.role === 'user')) {
      return reply.code(400).send({ error: 'A conversa precisa de uma mensagem do usuário.' })
    }

    try {
      const result = await service.respond(messages)
      request.log.info(result.telemetry, result.logMessage)
      return result.answer
    } catch (error) {
      if (error instanceof GenerationResponseError) {
        const { code, audit, usage } = error.result
        request.log.error({ ...service.metadata, code, audit, usage }, 'Falha ao gerar resposta')
        return reply.code(code === 'generation_failed' ? 502 : 503).send({ error: 'A assistente de IA está temporariamente indisponível. Tente novamente.' })
      }
      if (error instanceof KnowledgeSearchError) {
        request.log.error({ code: 'search_failed', ...service.metadata }, 'Falha ao consultar a base de conhecimento')
        return reply.code(503).send({ error: 'A base de conhecimento está temporariamente indisponível. Tente novamente.' })
      }
      request.log.error({ code: 'generation_failed', ...service.metadata }, 'Falha ao gerar resposta com a Groq')
      return reply.code(502).send({ error: 'A assistente de IA está temporariamente indisponível. Tente novamente.' })
    }
  })
}
