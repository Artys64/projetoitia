import { groq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'
import type { SupportChatMessage, SupportChatResponse } from '@support-hub/contracts'
import { loadArticles } from './knowledge/repository.js'
import { createTextSearch, retrievalQuery, type KnowledgeSearch } from './knowledge/search.js'
import { buildContext } from './knowledge/context.js'
import { PROMPT_VERSION } from './prompts/nora.js'
import { generateNoraResponse, KnowledgeSearchError } from './agents/nora.js'

export type ChatOptions = {
  useLlm?: boolean
  knowledgeSearch?: KnowledgeSearch
  knowledgeCompanyId?: string
  languageModel?: LanguageModel
}

const fallback: SupportChatResponse = {
  reply: 'Ainda não encontrei uma resposta segura para essa dúvida. Você pode reformular a pergunta ou consultar uma pessoa da equipe.',
  suggestions: ['Falar com uma pessoa', 'Voltar ao início'],
}

export function createChatService(options: ChatOptions = {}) {
  const search = options.knowledgeSearch ?? createTextSearch(loadArticles(process.env.KNOWLEDGE_FILE?.trim() || undefined))
  // The company is server-owned and never comes from the request body.
  const companyId = options.knowledgeCompanyId ?? (process.env.KNOWLEDGE_COMPANY_ID?.trim() || 'support-hub')
  const metadata = { companyId, promptVersion: PROMPT_VERSION }

  async function respond(messages: SupportChatMessage[]) {
    if (options.useLlm === false || (!options.languageModel && !process.env.GROQ_API_KEY)) {
      try {
        const { sources } = buildContext(await search(retrievalQuery(messages), companyId))
        const first = sources[0]
        const answer: SupportChatResponse = first
          ? { reply: first.text, suggestions: first.suggestions.length ? first.suggestions : fallback.suggestions }
          : fallback
        return {
          answer,
          telemetry: {
            ...metadata,
            sources: sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
            outcome: first ? 'excerpt' : 'no_context',
          },
          logMessage: 'Consulta local de conhecimento concluída',
        }
      } catch (error) {
        throw new KnowledgeSearchError(error)
      }
    }

    const model = options.languageModel ?? groq(process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b')
    const result = await generateNoraResponse({ model, messages, search, companyId })
    const answer: SupportChatResponse = result.text.trim()
      ? { reply: result.text, suggestions: result.sources[0]?.suggestions ?? [] }
      : fallback
    return {
      answer,
      telemetry: {
        ...metadata, model: result.model, usage: result.usage, searches: result.searches, steps: result.steps,
        sources: result.sources.map(({ articleId, version, chunk }) => ({ articleId, version, chunk })),
        outcome: result.text.trim() ? 'generated' : 'empty',
      },
      logMessage: 'Resposta RAG concluída',
    }
  }

  return { respond, metadata }
}
