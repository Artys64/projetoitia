import { createHash } from 'node:crypto'

export const ACTIVE_EMBEDDING_PROFILE = Object.freeze({
  id: 'multilingual-e5-small-v1',
  model: 'intfloat/multilingual-e5-small',
  revision: 'fd1525a9fd15316a2d503bf26ab031a61d056e98',
  dimensions: 384,
  maxTokens: 512,
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
})

export type EmbeddingKind = 'query' | 'passage'
export type EmbeddingBatch = { vectors: number[][]; tokenCounts: number[] }

export interface EmbeddingProvider {
  readonly profileId: string
  embed(texts: readonly string[], kind: EmbeddingKind, signal?: AbortSignal): Promise<EmbeddingBatch>
}

export function validateEmbeddingBatch(batch: EmbeddingBatch, expected: number): EmbeddingBatch {
  if (batch.vectors.length !== expected || batch.tokenCounts.length !== expected) {
    throw new Error('embedding_batch_incomplete')
  }
  for (let index = 0; index < expected; index++) {
    const vector = batch.vectors[index]
    const tokens = batch.tokenCounts[index]
    if (!vector || vector.length !== ACTIVE_EMBEDDING_PROFILE.dimensions ||
      !Number.isInteger(tokens) || tokens! < 1 || tokens! > ACTIVE_EMBEDDING_PROFILE.maxTokens ||
      vector.some(value => !Number.isFinite(value))) throw new Error('embedding_invalid')
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    if (!Number.isFinite(norm) || norm < 0.99 || norm > 1.01) throw new Error('embedding_not_normalized')
  }
  return batch
}

/** Deterministic normalized vectors for tests only; they do not model semantic similarity. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly profileId = ACTIVE_EMBEDDING_PROFILE.id
  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<EmbeddingBatch> {
    const prefix = kind === 'query' ? ACTIVE_EMBEDDING_PROFILE.queryPrefix : ACTIVE_EMBEDDING_PROFILE.passagePrefix
    const vectors = texts.map(text => {
      const seed = createHash('sha256').update(prefix + text).digest()
      const vector = Array.from({ length: ACTIVE_EMBEDDING_PROFILE.dimensions }, (_, index) =>
        (seed[index % seed.length]! - 127.5) / 127.5)
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
      return vector.map(value => value / norm)
    })
    return { vectors, tokenCounts: texts.map(text => Math.max(1, text.trim().split(/\s+/).length + 2)) }
  }
}
