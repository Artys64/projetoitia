import type { SearchHit } from './search.js'

export const MAX_CONTEXT_CHARS = 5000

export type KnowledgeEvidence = Readonly<{
  sourceId: string
  companyId: string
  articleId: string
  version: number
  title: string
  chunk: number
  text: string
}>

export class EvidenceIntegrityError extends Error {
  constructor() {
    super('As evidências da interação são inválidas ou inconsistentes.')
    this.name = 'EvidenceIntegrityError'
  }
}

export function evidenceId(source: Pick<KnowledgeEvidence, 'companyId' | 'articleId' | 'version' | 'chunk'>): string {
  return `${source.companyId}/${source.articleId}@${source.version}#${source.chunk}`
}

/** Snapshot only the hits actually included in a tool result, never the whole search index. */
export function collectEvidence(companyId: string, hits: readonly SearchHit[], previous: readonly KnowledgeEvidence[] = []): KnowledgeEvidence[] {
  const result = new Map(previous.map(source => [source.sourceId, source]))
  for (const hit of hits) {
    const identifier = /^[a-zA-Z0-9_-]{1,80}$/
    if (typeof hit.companyId !== 'string' || typeof hit.articleId !== 'string' ||
      hit.companyId !== companyId || !identifier.test(hit.companyId) || !identifier.test(hit.articleId) ||
      !Number.isSafeInteger(hit.version) || hit.version < 1 || !Number.isSafeInteger(hit.chunk) || hit.chunk < 0 ||
      typeof hit.title !== 'string' || !hit.title.trim() || hit.title.length > 160 ||
      typeof hit.text !== 'string' || !hit.text.trim() || hit.text.length > MAX_CONTEXT_CHARS) throw new EvidenceIntegrityError()
    const evidence: KnowledgeEvidence = Object.freeze({
      sourceId: evidenceId(hit), companyId: hit.companyId, articleId: hit.articleId,
      version: hit.version, title: hit.title, chunk: hit.chunk, text: hit.text,
    })
    const existing = result.get(evidence.sourceId)
    if (existing && (existing.text !== evidence.text || existing.title !== evidence.title)) throw new EvidenceIntegrityError()
    result.set(evidence.sourceId, evidence)
  }
  return [...result.values()]
}

export function buildContext(hits: SearchHit[]) {
  const sources: SearchHit[] = []
  let context = '[]'
  for (const hit of hits.slice(0, 4)) {
    const candidate = [...sources, structuredClone(hit)]
    const serialized = JSON.stringify(candidate.map(source => ({
      id: source.articleId, version: source.version, title: source.title, chunk: source.chunk, text: source.text,
    })))
    if (serialized.length > MAX_CONTEXT_CHARS) continue
    sources.push(candidate.at(-1)!)
    context = serialized
  }
  return { context, sources }
}
