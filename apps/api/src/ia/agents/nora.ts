import { isStepCount, jsonSchema, tool, ToolLoopAgent, type LanguageModel, type LanguageModelUsage, type ModelMessage } from 'ai'
import { buildContext, collectEvidence, type KnowledgeEvidence } from '../knowledge/context.js'
import { instructionsFor, PROMPT_VERSION } from '../prompts/nora.js'
import type { KnowledgeSearch, SearchHit } from '../knowledge/search.js'
import { CallDeadlineError, requireTime, withinDeadline, RESPONSE_TIMEOUT_MS } from '../deadline.js'
import { sumUsage } from '../usage.js'

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

type NoraOptions = {
  model: LanguageModel
  messages: ModelMessage[]
  search: KnowledgeSearch
  companyId: string
  deadlineAt?: number
  onUsage?: (usage: LanguageModelUsage) => void
}

export async function generateNoraDraft(options: NoraOptions) {
  const started = Date.now()
  const deadlineAt = Math.min(options.deadlineAt ?? started + RESPONSE_TIMEOUT_MS, started + RESPONSE_TIMEOUT_MS)
  requireTime(deadlineAt)
  // Per-request state: neither history nor retrieved sources leak across conversations.
  const sources: SearchHit[] = []
  let evidence: KnowledgeEvidence[] = []
  let searches = 0
  let searchError: KnowledgeSearchError | CallDeadlineError | undefined
  const stepUsage: LanguageModelUsage[] = []
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
            requireTime(deadlineAt)
            const searchDeadline = Math.min(deadlineAt, Date.now() + 3_000)
            const hits = await withinDeadline(searchDeadline, signal =>
              options.search(query, options.companyId, { signal, deadlineAt: searchDeadline }))
            const retrieved = buildContext(hits)
            evidence = collectEvidence(options.companyId, retrieved.sources, evidence)
            for (const source of retrieved.sources) {
              if (!sources.some(previous => previous.companyId === source.companyId && previous.articleId === source.articleId &&
                previous.version === source.version && previous.chunk === source.chunk)) sources.push(source)
            }
            return { status: retrieved.sources.length ? 'found' : 'not_found', context: retrieved.context }
          } catch (error) {
            searchError = error instanceof CallDeadlineError ? error : new KnowledgeSearchError(error)
            throw searchError
          }
        },
      }),
    },
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => {
      // The SDK captures tool errors; propagate lookup failures before another LLM call.
      if (searchError) throw searchError
      requireTime(deadlineAt)
      if (stepNumber >= MAX_STEPS - 1 || searches >= MAX_SEARCHES) return { toolChoice: 'none' }
    },
    // Leave room for contextual interpretation and tool selection in reasoning models.
    maxOutputTokens: 1200,
    temperature: 0,
    maxRetries: 0,
    onStepEnd: step => {
      stepUsage.push(step.usage)
      options.onUsage?.(sumUsage(...stepUsage))
    },
    providerOptions: { groq: { reasoningEffort: 'medium', parallelToolCalls: false } },
  })

  const result = await withinDeadline(deadlineAt, abortSignal => agent.generate({ messages: options.messages, abortSignal }))
  if (searchError) throw searchError
  return {
    text: result.text,
    sources,
    evidence: Object.freeze(evidence),
    promptVersion: PROMPT_VERSION,
    durationMs: Date.now() - started,
    searches,
    steps: result.steps.length,
    model: result.response.modelId,
    usage: result.totalUsage,
  }
}

/** Unverified baseline for the offline comparison script only; never use in chat publication. */
export async function generateNoraResponse(options: NoraOptions) {
  const { text, sources, searches, steps, model, usage } = await generateNoraDraft(options)
  return { text, sources, searches, steps, model, usage }
}
