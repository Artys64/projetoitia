import { registerEmbed, type EmbedOptions } from './embed.js'
import { groq } from '@ai-sdk/groq'
import { generateText, type LanguageModel } from 'ai'
import Fastify, { type FastifyInstance } from 'fastify'
import { loadArticles } from './knowledge/repository.js'
import { createTextSearch, normalize, retrievalQuery, type KnowledgeSearch } from './knowledge/search.js'
import { buildContext, instructionsFor, PROMPT_VERSION } from './knowledge/context.js'

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

function conversationalAnswer(message: string): ChatAnswer | null {
  const text = normalize(message).trim().replace(/[.!?]+$/g, '').trim()
  if (/^(oi|ola|bom dia|boa tarde|boa noite|voltar ao inicio|continuar com a assistente)$/.test(text)) {
    return {
      reply: 'Olá! Posso ajudar com acesso à conta, planos e integrações usando nossa base de conhecimento.',
      suggestions: ['Esqueci minha senha', 'Conhecer os planos', 'Falar com uma pessoa'],
    }
  }
  if (/^(?:quero )?(?:falar com (?:uma pessoa|um humano|um atendente|a equipe)|deixar uma mensagem)$/.test(text)) {
    return {
      reply: 'Esta demonstração ainda não encaminha conversas para atendimento humano. Você pode continuar consultando a base de conhecimento por aqui.',
      suggestions: ['Horário de atendimento', 'Continuar com a assistente'],
    }
  }
  return null
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
    const conversational = conversationalAnswer(lastUserMessage.content)
    if (conversational) return conversational

    let retrieved: ReturnType<typeof buildContext>
    try {
      retrieved = buildContext(await search(retrievalQuery(messages), companyId))
    } catch (error) {
      request.log.error({ error }, 'Falha ao consultar a base de conhecimento')
      return reply.code(503).send({ error: 'A base de conhecimento está temporariamente indisponível. Tente novamente.' })
    }
    const { context, sources } = retrieved
    const metadata = {
      companyId, promptVersion: PROMPT_VERSION,
      sources: sources.map(source => ({ articleId: source.articleId, version: source.version, chunk: source.chunk })),
    }
    const first = sources[0]
    if (!first) {
      request.log.info({ ...metadata, outcome: 'no_context' }, 'Consulta de conhecimento concluída')
      return fallback
    }
    const suggestions = first.suggestions.length ? first.suggestions : fallback.suggestions
    if (options.useLlm === false || (!options.languageModel && !process.env.GROQ_API_KEY)) {
      request.log.info({ ...metadata, outcome: 'excerpt' }, 'Consulta de conhecimento concluída')
      return { reply: first.text, suggestions }
    }

    const model = options.languageModel ?? groq(process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b')
    try {
      const result = await generateText({
        model,
        instructions: instructionsFor(context),
        messages,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(20000),
        providerOptions: { groq: { reasoningEffort: 'low' } },
      })
      request.log.info({ ...metadata, model: result.response.modelId, usage: result.usage, outcome: result.text.trim() ? 'generated' : 'empty' }, 'Resposta RAG concluída')
      return result.text.trim() ? { reply: result.text, suggestions } : fallback
    } catch (error) {
      request.log.error({ error, ...metadata }, 'Falha ao gerar resposta com a Groq')
      return reply.code(502).send({ error: 'A assistente de IA está temporariamente indisponível. Tente novamente.' })
    }
  })
  return app
}
