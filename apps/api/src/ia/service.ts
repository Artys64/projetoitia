import type { LanguageModel } from 'ai'
import type { SupportChatMessage, SupportChatResponse } from '@support-hub/contracts'
import { loadArticles } from './knowledge/repository.js'
import { createTextSearch, retrievalQuery, type KnowledgeSearch } from './knowledge/search.js'
import { buildContext } from './knowledge/context.js'
import { PROMPT_VERSION } from './prompts/nora.js'
import { KnowledgeSearchError } from './agents/nora.js'
import { createGenerator } from './runtime.js'
import type { GeneratedResponse } from './generated-response.js'

export type ChatOptions = {
  useLlm?: boolean
  knowledgeSearch?: KnowledgeSearch
  knowledgeCompanyId?: string
  languageModel?: LanguageModel
}

export const LOCAL_DEMO_PREFIX = 'Demonstração local, sem avaliação de pertinência.\n\n'
const fallback: SupportChatResponse = {
  reply: LOCAL_DEMO_PREFIX + 'Não encontrei uma orientação na base para responder a essa dúvida.',
  suggestions: [],
}

export class GenerationResponseError extends Error {
  constructor(readonly result: Extract<GeneratedResponse, { status: 'blocked' }>) {
    super('Não foi possível preparar uma resposta.')
    this.name = 'GenerationResponseError'
  }
}

export function createChatService(options: ChatOptions = {}) {
  const search = options.knowledgeSearch ?? createTextSearch(loadArticles(process.env.KNOWLEDGE_FILE?.trim() || undefined))
  // The company is server-owned and never comes from the request body.
  const companyId = options.knowledgeCompanyId ?? (process.env.KNOWLEDGE_COMPANY_ID?.trim() || 'support-hub')
  const metadata = { companyId, promptVersion: PROMPT_VERSION }
  const generate = createGenerator(options)

  async function respond(messages: SupportChatMessage[]) {
    if (options.useLlm === false || (!options.languageModel && !process.env.GROQ_API_KEY)) {
      try {
        const { sources } = buildContext(await search(retrievalQuery(messages), companyId))
        const first = sources[0]
        const answer: SupportChatResponse = first
          ? { reply: LOCAL_DEMO_PREFIX + first.text, suggestions: [] }
          : fallback
        return {
          answer,
          telemetry: {
            ...metadata,
            sources: sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
            outcome: first ? 'demo_excerpt' : 'demo_no_context',
          },
          logMessage: 'Consulta local de conhecimento concluída',
        }
      } catch (error) {
        throw new KnowledgeSearchError(error)
      }
    }

    const result = await generate({ messages, search, companyId })
    if (result.status === 'blocked') throw new GenerationResponseError(result)
    const answer: SupportChatResponse = { reply: result.text, suggestions: [] }
    return {
      answer,
      telemetry: {
        ...metadata, model: result.audit.generation.model, usage: result.usage,
        searches: result.audit.generation.searches, steps: result.audit.generation.steps, audit: result.audit,
        sources: result.sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
        outcome: result.mode,
      },
      logMessage: 'Resposta RAG concluída',
    }
  }

  return { respond, metadata }
}
