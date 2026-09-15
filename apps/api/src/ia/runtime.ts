import { groq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'
import { generateNoraResponse, type GenerationInput } from './generated-response.js'

export type Generate = (input: GenerationInput) => ReturnType<typeof generateNoraResponse>

export function createGenerator(options: { languageModel?: LanguageModel } = {}): Generate {
  // Injected models keep local tests independent of credentials and external calls.
  const modelId = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b'
  const model = options.languageModel ?? groq(modelId)
  return input => generateNoraResponse({ ...input, model })
}
