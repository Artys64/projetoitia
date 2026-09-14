import { readFileSync } from 'node:fs'

export type Article = {
  id: string
  companyId: string
  version: number
  status: 'draft' | 'published'
  title: string
  keywords: string[]
  content: string
  suggestions: string[]
}

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const texts = (value: unknown, count: number, max: number): value is string[] =>
  Array.isArray(value) && value.length <= count && value.every(item => text(item, max))

export function validateArticles(value: unknown): Article[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Base de conhecimento inválida: esperado um array de até 1000 artigos.')
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || !identifier(item.id) || !identifier(item.companyId) ||
      !Number.isSafeInteger(item.version) || item.version < 1 ||
      !['draft', 'published'].includes(item.status) || !text(item.title, 160) ||
      !text(item.content, 50000) || !texts(item.keywords, 30, 80) || !texts(item.suggestions, 4, 80)) {
      throw new Error('Artigo inválido na base de conhecimento.')
    }
    const key = `${item.companyId}/${item.id}`
    if (seen.has(key)) throw new Error(`Artigo duplicado: ${key}`)
    seen.add(key)
  }
  // Snapshot: publication changes become effective on the next server restart.
  return structuredClone(value as Article[])
}

export function loadArticles(path: string | URL = new URL('../../../knowledge/articles.json', import.meta.url)): Article[] {
  return validateArticles(JSON.parse(readFileSync(path, 'utf8')))
}
