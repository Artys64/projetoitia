import type { LanguageModel, LanguageModelUsage } from 'ai'
import { generateNoraDraft, KnowledgeSearchError } from './agents/nora.js'
import { CallDeadlineError, GENERATION_TIMEOUT_MS, RESPONSE_TIMEOUT_MS } from './deadline.js'
import type { KnowledgeEvidence } from './knowledge/context.js'
import type { KnowledgeSearch } from './knowledge/search.js'
import { PROMPT_VERSION } from './prompts/nora.js'
import { sumUsage } from './usage.js'

type ConversationMessage = { role: 'user' | 'assistant'; content: string }
type SourceReference = Pick<KnowledgeEvidence, 'sourceId' | 'companyId' | 'articleId' | 'version' | 'chunk' | 'title' | 'indexSetId' | 'literalHash'>

export type ResponseAudit = {
  durationMs: number
  generation: {
    promptVersion: string
    model: string | null
    durationMs: number
    usage: LanguageModelUsage | null
    completed: boolean
    searches: number | null
    steps: number | null
  }
  retrievedSources: SourceReference[]
}

export type GeneratedResponse = ({
  status: 'publish'
  mode: 'generated'
  text: string
  sources: readonly KnowledgeEvidence[]
} | {
  status: 'blocked'
  code: 'invalid_input' | 'generation_failed' | 'search_failed' | 'timeout' | 'insufficient_time'
}) & {
  audit: ResponseAudit
  usage: LanguageModelUsage
}

export type GenerationInput = {
  messages: ReadonlyArray<ConversationMessage>
  search: KnowledgeSearch
  companyId: string
}

const references = (sources: readonly KnowledgeEvidence[]): SourceReference[] =>
  sources.map(({ sourceId, companyId, articleId, version, chunk, title, indexSetId, literalHash }) => ({
    sourceId, companyId, articleId, version, chunk, title, indexSetId, literalHash,
  }))

function validInput(companyId: string, messages: ReadonlyArray<ConversationMessage>): boolean {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(companyId) || messages.length === 0 || messages.length > 12) return false
  if (messages.at(-1)?.role !== 'user') return false
  return messages.every(message =>
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' && message.content.trim().length > 0 &&
    message.content.length <= (message.role === 'user' ? 500 : 8000))
}

/** Shared single-model entry point for the worker and development chat. */
export async function generateNoraResponse(options: GenerationInput & {
  model: LanguageModel
  deadlineAt?: number
}): Promise<GeneratedResponse> {
  const started = Date.now()
  const deadlineAt = Math.min(options.deadlineAt ?? started + RESPONSE_TIMEOUT_MS, started + RESPONSE_TIMEOUT_MS)
  const audit: ResponseAudit = {
    durationMs: 0,
    generation: {
      promptVersion: PROMPT_VERSION, model: null, durationMs: 0, usage: null,
      completed: false, searches: null, steps: null,
    },
    retrievedSources: [],
  }
  const messages = structuredClone(options.messages)
  if (!validInput(options.companyId, messages)) {
    audit.durationMs = Date.now() - started
    return { status: 'blocked', code: 'invalid_input', audit, usage: sumUsage(null) }
  }

  try {
    const draft = await generateNoraDraft({
      model: options.model,
      messages: [...messages],
      search: options.search,
      companyId: options.companyId,
      deadlineAt: Math.min(started + GENERATION_TIMEOUT_MS, deadlineAt),
      onUsage: usage => { audit.generation.usage = usage },
    })
    audit.generation = {
      promptVersion: draft.promptVersion, model: draft.model, durationMs: draft.durationMs,
      usage: sumUsage(draft.usage), completed: true, searches: draft.searches, steps: draft.steps,
    }
    audit.retrievedSources = references(draft.evidence)
    audit.durationMs = Date.now() - started
    const usage = sumUsage(draft.usage)
    if (!draft.text.trim() || draft.text.length > 8000) {
      return { status: 'blocked', code: 'generation_failed', audit, usage }
    }
    return {
      status: 'publish', mode: 'generated', text: draft.text,
      sources: structuredClone(draft.evidence), audit, usage,
    }
  } catch (error) {
    audit.durationMs = audit.generation.durationMs = Date.now() - started
    const code = error instanceof CallDeadlineError ? error.code
      : error instanceof KnowledgeSearchError ? 'search_failed' : 'generation_failed'
    return { status: 'blocked', code, audit: structuredClone(audit), usage: sumUsage(audit.generation.usage) }
  }
}
