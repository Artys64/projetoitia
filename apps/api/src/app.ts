import { registerEmbed, type EmbedOptions } from './embed.js'
import { groq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'
import Fastify, { type FastifyInstance } from 'fastify'
import { loadArticles } from './knowledge/repository.js'
import { createTextSearch, retrievalQuery, type KnowledgeSearch } from './knowledge/search.js'
import { buildContext, PROMPT_VERSION } from './knowledge/context.js'
import { generateNoraResponse, KnowledgeSearchError } from './agents/nora.js'

type BuildAppOptions = EmbedOptions & {
  logger?: boolean
  useLlm?: boolean
  knowledgeSearch?: KnowledgeSearch
  knowledgeCompanyId?: string
  languageModel?: LanguageModel
}

type ChatAnswer = { reply: string; suggestions: string[] }
type ChatRequestBody = { message?: unknown; messages?: unknown }
type ChatMessage = { role: 'user' | 'assistant'; content: string }

const fallback: ChatAnswer = {
  reply: 'Ainda não encontrei uma resposta segura para essa dúvida. Você pode reformular a pergunta ou consultar uma pessoa da equipe.',
  suggestions: ['Falar com uma pessoa', 'Voltar ao início'],
}

function parseMessages(body: ChatRequestBody): ChatMessage[] | null {
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
      const message = item as ChatMessage
      return { role: message.role, content: message.content.trim() }
    })
  }
  if (typeof body.message === 'string' && body.message.trim() && body.message.length <= 500) {
    return [{ role: 'user', content: body.message.trim() }]
  }
  return null
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true })
  const search = options.knowledgeSearch ?? createTextSearch(loadArticles(process.env.KNOWLEDGE_FILE?.trim() || undefined))
  // Server-owned scope for the existing single-company demo. Never trust a body companyId.
  const companyId = options.knowledgeCompanyId ?? (process.env.KNOWLEDGE_COMPANY_ID?.trim() || 'support-hub')
  registerEmbed(app, options)

  app.get('/api/health', async () => ({
    status: 'ok' as const,
    service: 'support-hub-api',
    timestamp: new Date().toISOString(),
  }))

  app.post<{ Body: ChatRequestBody }>('/api/chat', async (request, reply) => {
    const messages = parseMessages(request.body ?? {})
    if (!messages) {
      return reply.code(400).send({ error: 'Envie uma conversa válida com mensagens de usuário de até 500 caracteres.' })
    }
    const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')
    if (!lastUserMessage) {
      return reply.code(400).send({ error: 'A conversa precisa de uma mensagem do usuário.' })
    }
    const metadata = { companyId, promptVersion: PROMPT_VERSION }
    if (options.useLlm === false || (!options.languageModel && !process.env.GROQ_API_KEY)) {
      try {
        const { sources } = buildContext(await search(retrievalQuery(messages), companyId))
        const first = sources[0]
        request.log.info({
          ...metadata, sources: sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
          outcome: first ? 'excerpt' : 'no_context',
        }, 'Consulta local de conhecimento concluída')
        return first ? { reply: first.text, suggestions: first.suggestions.length ? first.suggestions : fallback.suggestions } : fallback
      } catch (error) {
        request.log.error({ error }, 'Falha ao consultar a base de conhecimento')
        return reply.code(503).send({ error: 'A base de conhecimento está temporariamente indisponível. Tente novamente.' })
      }
    }

    const model = options.languageModel ?? groq(process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b')
    try {
      const result = await generateNoraResponse({ model, messages, search, companyId })
      request.log.info({
        ...metadata, model: result.model, usage: result.usage, searches: result.searches, steps: result.steps,
        sources: result.sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
        outcome: result.text.trim() ? 'generated' : 'empty',
      }, 'Resposta RAG concluída')
      const suggestions = result.sources[0]?.suggestions ?? []
      return result.text.trim() ? { reply: result.text, suggestions } : fallback
    } catch (error) {
      if (error instanceof KnowledgeSearchError) {
        request.log.error({ error, ...metadata }, 'Falha ao consultar a base de conhecimento')
        return reply.code(503).send({ error: 'A base de conhecimento está temporariamente indisponível. Tente novamente.' })
      }
      request.log.error({ error, ...metadata }, 'Falha ao gerar resposta com a Groq')
      return reply.code(502).send({ error: 'A assistente de IA está temporariamente indisponível. Tente novamente.' })
    }
  })
  return app
}
