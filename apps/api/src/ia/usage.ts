import type { LanguageModelUsage } from 'ai'

/** Unknown provider counts remain unknown; do not report them as zero-cost calls. */
export function sumUsage(...usages: Array<LanguageModelUsage | null>): LanguageModelUsage {
  const sum = (select: (usage: LanguageModelUsage) => number | undefined) => {
    const values = usages.map(usage => usage === null ? undefined : select(usage))
    return values.length === 0 || values.some(value => value === undefined) ? undefined
      : (values as number[]).reduce((total, value) => total + value, 0)
  }
  return {
    inputTokens: sum(usage => usage.inputTokens),
    outputTokens: sum(usage => usage.outputTokens),
    totalTokens: sum(usage => usage.totalTokens),
    inputTokenDetails: {
      noCacheTokens: sum(usage => usage.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: sum(usage => usage.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: sum(usage => usage.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokenDetails: {
      textTokens: sum(usage => usage.outputTokenDetails?.textTokens),
      reasoningTokens: sum(usage => usage.outputTokenDetails?.reasoningTokens),
    },
  }
}
