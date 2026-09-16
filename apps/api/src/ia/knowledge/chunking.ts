import { createHash } from 'node:crypto'

export const SPLITTER_VERSION = 'markdown-words-v1'
const TARGET_TOKENS = 250
const MAX_TOKENS = 400
const OVERLAP_TOKENS = 40

export type KnowledgeChunk = {
  index: number
  text: string
  sectionTitle: string | null
  tokenCount: number
  literalHash: string
  locator: { blockStart: number; blockEnd: number }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type Block = { text: string; sectionTitle: string | null; position: number }

function blocks(content: string, format: 'text' | 'markdown'): Block[] {
  let sectionTitle: string | null = null
  const result: Block[] = []
  let position = 0
  for (const raw of content.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const text = raw.trim()
    if (!text) continue
    const heading = format === 'markdown' ? text.match(/^#{1,6}\s+(.+?)(?:\n|$)/) : null
    if (heading) sectionTitle = heading[1]!.trim().slice(0, 160)
    result.push({ text, sectionTitle, position: position++ })
  }
  return result
}

export function splitKnowledgeDocument(content: string, format: 'text' | 'markdown'): KnowledgeChunk[] {
  const source = blocks(content, format)
  if (!source.length) throw new Error('knowledge_empty')
  const chunks: KnowledgeChunk[] = []
  let words: string[] = []
  let sectionTitle: string | null = null
  let blockStart = 0
  let blockEnd = 0
  const flush = () => {
    if (!words.length) return
    const text = words.join(' ')
    chunks.push({ index: chunks.length, text, sectionTitle, tokenCount: words.length,
      literalHash: hash(text), locator: { blockStart, blockEnd } })
    words = words.slice(Math.max(0, words.length - OVERLAP_TOKENS))
    blockStart = blockEnd
  }
  for (const block of source) {
    const blockWords = block.text.split(/\s+/).filter(Boolean)
    let offset = 0
    while (offset < blockWords.length) {
      if (!words.length) { sectionTitle = block.sectionTitle; blockStart = block.position }
      const take = Math.min(MAX_TOKENS - words.length, blockWords.length - offset)
      words.push(...blockWords.slice(offset, offset + take))
      offset += take
      blockEnd = block.position
      if (words.length >= MAX_TOKENS || (words.length >= TARGET_TOKENS && offset >= blockWords.length)) flush()
    }
  }
  if (words.length > OVERLAP_TOKENS || !chunks.length) flush()
  return chunks.map((chunk, index) => ({ ...chunk, index }))
}

export function contentHash(content: string): string {
  return hash(content.replace(/\r\n?/g, '\n'))
}

export function embeddingInput(title: string, chunk: KnowledgeChunk): string {
  return [title, chunk.sectionTitle, chunk.text].filter(Boolean).join('\n')
}

export function embeddingInputHash(value: string): string { return hash(value) }
