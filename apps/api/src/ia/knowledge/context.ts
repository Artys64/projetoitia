import type { SearchHit } from './search.js'

export const MAX_CONTEXT_CHARS = 5000

export function buildContext(hits: SearchHit[]) {
  const sources: SearchHit[] = []
  let context = '[]'
  for (const hit of hits.slice(0, 4)) {
    const candidate = [...sources, hit]
    const serialized = JSON.stringify(candidate.map(source => ({
      id: source.articleId, version: source.version, title: source.title, chunk: source.chunk, text: source.text,
    })))
    if (serialized.length > MAX_CONTEXT_CHARS) continue
    sources.push(hit)
    context = serialized
  }
  return { context, sources }
}
