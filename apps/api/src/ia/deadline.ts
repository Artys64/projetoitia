export const RESPONSE_TIMEOUT_MS = 20_000
export const GENERATION_TIMEOUT_MS = 20_000
export const MIN_CALL_TIME_MS = 1_000

export class CallDeadlineError extends Error {
  constructor(readonly code: 'timeout' | 'insufficient_time') {
    super('O orçamento de tempo da resposta foi esgotado.')
    this.name = 'CallDeadlineError'
  }
}

export function requireTime(deadlineAt: number, minimumMs = MIN_CALL_TIME_MS): void {
  if (!Number.isFinite(deadlineAt) || deadlineAt - Date.now() < minimumMs) throw new CallDeadlineError('insufficient_time')
}

/** A race also blocks late results from a provider/tool that ignores cancellation. */
export async function withinDeadline<T>(deadlineAt: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  requireTime(deadlineAt)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new CallDeadlineError('timeout')
      controller.abort(error)
      reject(error)
    }, Math.max(0, deadlineAt - Date.now()))
  })
  try {
    const result = await Promise.race([operation(controller.signal), timeout])
    if (Date.now() >= deadlineAt) throw new CallDeadlineError('timeout')
    return result
  } finally {
    clearTimeout(timer)
  }
}
