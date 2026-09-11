import { isStepCount, jsonSchema, tool, ToolLoopAgent, type LanguageModel, type ModelMessage } from 'ai'
import { buildContext, instructionsFor } from '../knowledge/context.js'
import type { KnowledgeSearch, SearchHit } from '../knowledge/search.js'

const MAX_SEARCHES = 2
const MAX_STEPS = 3

const searchInput = jsonSchema<{ query: string }>({
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 500, description: 'Consulta autossuficiente sobre o problema atual, incluindo o que a última resposta confirmou ou negou. Use termos específicos; omita o nome do produto e palavras genéricas que não ajudam a localizar o artigo.' },
  },
  required: ['query'],
  additionalProperties: false,
}, {
  validate: value => {
    if (value && typeof value === 'object' && 'query' in value &&
      typeof value.query === 'string' && value.query.trim().length > 0 && value.query.length <= 500 &&
      Object.keys(value).length === 1) {
      return { success: true, value: { query: value.query.trim() } }
    }
    return { success: false, error: new Error('A busca precisa de uma pergunta de até 500 caracteres.') }
  },
})

export class KnowledgeSearchError extends Error {
  constructor(cause: unknown) {
    super('A base de conhecimento está temporariamente indisponível.', { cause })
    this.name = 'KnowledgeSearchError'
  }
}

export async function generateNoraResponse(options: {
  model: LanguageModel
  messages: ModelMessage[]
  search: KnowledgeSearch
  companyId: string
}) {
  // Per-request state: neither history nor retrieved sources leak across conversations.
  const sources: SearchHit[] = []
  let searches = 0
  let searchError: KnowledgeSearchError | undefined
  const agent = new ToolLoopAgent({
    model: options.model,
    instructions: instructionsFor(),
    tools: {
      searchKnowledge: tool({
        description: 'Consulta artigos publicados do produto. Use assim que identificar uma dúvida ou dificuldade com o produto, antes de responder ou fazer perguntas de triagem. Reescreva a dúvida com o contexto da última mensagem. Não é necessária para conversa social.',
        inputSchema: searchInput,
        execute: async ({ query }) => {
          // Also cap execution if a provider returns several tool calls in one step.
          if (searches >= MAX_SEARCHES) return { status: 'limit_reached', context: '[]' }
          searches++
          try {
            const retrieved = buildContext(await options.search(query, options.companyId))
            sources.push(...retrieved.sources)
            return { status: retrieved.sources.length ? 'found' : 'not_found', context: retrieved.context }
          } catch (error) {
            searchError = new KnowledgeSearchError(error)
            throw searchError
          }
        },
      }),
    },
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => {
      // The SDK captures tool errors; propagate lookup failures before another LLM call.
      if (searchError) throw searchError
      if (stepNumber >= MAX_STEPS - 1 || searches >= MAX_SEARCHES) return { toolChoice: 'none' }
    },
    // Leave room for contextual interpretation and tool selection in reasoning models.
    maxOutputTokens: 1200,
    temperature: 0,
    providerOptions: { groq: { reasoningEffort: 'medium', parallelToolCalls: false } },
  })

  const result = await agent.generate({ messages: options.messages, abortSignal: AbortSignal.timeout(20000) })
  if (searchError) throw searchError
  return {
    text: result.text,
    sources,
    searches,
    steps: result.steps.length,
    model: result.response.modelId,
    usage: result.totalUsage,
  }
}
