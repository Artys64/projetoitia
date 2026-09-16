import { validateArticles, type Article } from './repository.js'

export type SearchHit = {
  companyId: string
  articleId: string
  version: number
  title: string
  chunk: number
  text: string
  suggestions: string[]
  score: number
  indexSetId?: string
  literalHash?: string
}

export type KnowledgeSearch = (
  query: string,
  companyId: string,
  options?: { signal?: AbortSignal; deadlineAt?: number },
) => Promise<SearchHit[]>

const stopwords = new Set('a o as os um uma de da do das dos e em no na nos nas ao aos que qual quais como para por com se meu minha sua seu eu voce nao sim foi ser esta esse essa isso isto ele ela aqui ainda sobre gostaria quero saber pode posso favor porfavor me tem tenho quanto'.split(' '))

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/e-mail/g, 'email')
}

function tokens(text: string): Set<string> {
  return new Set((normalize(text).match(/[a-z0-9]+/g) ?? [])
    .filter(word => word.length > 1 && !stopwords.has(word))
    .map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))
}

// Prefer paragraphs and sentence boundaries; cap even very long unbroken text.
export function splitContent(content: string): string[] {
  const chunks: string[] = []
  for (const paragraph of content.split(/\n\s*\n/)) {
    let remaining = paragraph.trim()
    while (remaining.length > 900) {
      const candidate = remaining.slice(0, 900)
      const sentence = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('? '), candidate.lastIndexOf('! '))
      const boundary = sentence >= 300 ? sentence + 1 : candidate.lastIndexOf(' ')
      const end = boundary > 0 ? boundary : 900
      chunks.push(remaining.slice(0, end).trim())
      remaining = remaining.slice(end).trim()
    }
    if (remaining) chunks.push(remaining)
  }
  return chunks
}

export function createTextSearch(articles: Article[]): KnowledgeSearch {
  const index = validateArticles(articles).filter(article => article.status === 'published').flatMap(article =>
    splitContent(article.content).map((text, chunk) => ({
      companyId: article.companyId,
      titleTokens: tokens(article.title),
      keywordTokens: tokens(article.keywords.join(' ')),
      bodyTokens: tokens(text),
      hit: { companyId: article.companyId, articleId: article.id, version: article.version, title: article.title, chunk, text, suggestions: article.suggestions },
    })))

  return async (query, companyId) => {
    const terms = [...tokens(query)]
    if (!terms.length) return []
    // Scope before ranking: documents belonging to other companies never participate.
    const candidates = index.filter(entry => entry.companyId === companyId)
    const ranked = candidates.map(entry => {
      let matched = 0
      let score = 0
      for (const term of terms) {
        const weight = (entry.titleTokens.has(term) ? 3 : 0) +
          (entry.keywordTokens.has(term) ? 2 : 0) + (entry.bodyTokens.has(term) ? 1 : 0)
        if (weight) { matched++; score += weight }
      }
      return { ...entry.hit, score, coverage: matched / terms.length }
    }).filter(hit => hit.score >= 2 && hit.coverage >= 0.4)
      .sort((a, b) => b.score - a.score || a.articleId.localeCompare(b.articleId) || a.chunk - b.chunk)
    return ranked.slice(0, 4).map(({ coverage: _coverage, ...hit }) => hit)
  }
}

export function retrievalQuery(messages: Array<{ role: string; content: string }>): string {
  const questions = messages.filter(message => message.role === 'user').map(message => message.content)
  const last = questions.at(-1) ?? ''
  // Only explicit follow-ups inherit the preceding question, never assistant claims.
  const followUp = /^(e (?:quanto|qual|como|se|por)|quanto tempo|por quanto tempo|e depois|isso|nesse caso|e ele|e ela)\b/.test(normalize(last).trim())
  return followUp && questions.length > 1 ? `${questions.at(-2)}\n${last}` : last
}
