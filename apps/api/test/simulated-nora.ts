import { MockLanguageModelV4 } from 'ai/test'
import { generateNoraResponse } from '../src/ia/generated-response.js'
import type { Generate } from '../src/ia/runtime.js'

export function generation(text: string) {
  return { content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined } }, warnings: [] }
}

export function lookup(query: string) {
  return { ...generation(''), content: [{ type: 'tool-call' as const, toolCallId: 'fixture-search', toolName: 'searchKnowledge', input: JSON.stringify({ query }) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined } }
}

export function fixtureGenerate(options: {
  draft?: string
  beforeReturn?: () => Promise<void>
} = {}): Generate {
  return async input => {
    let calls = 0
    const model = new MockLanguageModelV4({ doGenerate: async call => {
      if (calls++ === 0) return lookup(input.messages.at(-1)!.content)
      let content: string | undefined
      for (const message of call.prompt) if (message.role === 'tool') {
        for (const part of message.content) if (part.type === 'tool-result' && part.output.type === 'json') {
          const value = part.output.value as { context?: string }
          if (value.context) content = (JSON.parse(value.context) as Array<{ text: string }>)[0]?.text
        }
      }
      return generation(options.draft ?? content ?? 'Não encontrei uma orientação na base para responder a essa dúvida.')
    } })
    const result = await generateNoraResponse({ ...input, model })
    await options.beforeReturn?.()
    return result
  }
}
