import type { Payloads } from '@support-hub/contracts'

type EventName = 'ready' | 'opened' | 'closed' | 'error'
type Callback = (payload: Payloads[EventName]) => void

export type LoaderApi = {
  open(): void
  close(): void
  on(event: EventName, callback: Callback): void
  off(event: EventName, callback: Callback): void
}

export function reportGlobalError(code: string): void {
  window.dispatchEvent(new CustomEvent('supporthub:error', {
    detail: { code, message: 'Não foi possível iniciar a central de suporte.' },
  }))
  console.error('[SupportHub]', code)
}

export function createEvents() {
  const listeners = new Map<EventName, Set<Callback>>()

  function emit<Event extends EventName>(event: Event, payload: Payloads[Event]): void {
    listeners.get(event)?.forEach(callback => {
      try {
        callback(payload)
      } catch (error) {
        console.error(error)
      }
    })
  }

  function report(code: string): void {
    emit('error', { code, message: 'Não foi possível usar a central de suporte.' })
    reportGlobalError(code)
  }

  return {
    emit,
    report,
    on(event: EventName, callback: Callback): void {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(callback)
    },
    off(event: EventName, callback: Callback): void {
      listeners.get(event)?.delete(callback)
    },
  }
}
