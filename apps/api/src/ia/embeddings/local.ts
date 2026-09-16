import {
  ACTIVE_EMBEDDING_PROFILE,
  validateEmbeddingBatch,
  type EmbeddingBatch,
  type EmbeddingKind,
  type EmbeddingProvider,
} from './provider.js'

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly profileId = ACTIVE_EMBEDDING_PROFILE.id
  readonly endpoint: string
  constructor(endpoint: string, readonly timeoutMs = 3_000) {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('EMBEDDINGS_URL inválida')
    this.endpoint = url.toString().replace(/\/$/, '')
  }

  async embed(texts: readonly string[], kind: EmbeddingKind, signal?: AbortSignal): Promise<EmbeddingBatch> {
    if (!texts.length || texts.length > 32 || texts.some(text => !text.trim() || text.length > 12_000)) {
      throw new Error('embedding_input_invalid')
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(`${this.endpoint}/embed`, {
      method: 'POST', signal: combined,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: this.profileId, kind, texts }),
    })
    if (!response.ok) throw new Error(response.status === 422 ? 'embedding_input_too_long' : 'embedding_unavailable')
    const value = await response.json() as EmbeddingBatch & { profile?: string }
    if (value.profile !== this.profileId) throw new Error('embedding_profile_mismatch')
    return validateEmbeddingBatch(value, texts.length)
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const endpoint = process.env.EMBEDDINGS_URL?.trim()
  if (!endpoint) throw new Error('Configure EMBEDDINGS_URL para a recuperação híbrida')
  return new LocalEmbeddingProvider(endpoint)
}
