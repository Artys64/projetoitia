import { envelope, isEnvelope, type Payloads } from '@support-hub/contracts'

export type Command = 'open' | 'close'

type ChannelOptions = {
  origin: string
  installationId: string
  getTarget: () => Window | null
  onReady: () => void
  onOpened: () => void
  onClosed: (payload: Payloads['closed']) => void
  onError: (code: string) => void
}

export function createWidgetChannel(options: ChannelOptions) {
  const { origin, installationId, getTarget, onReady, onOpened, onClosed, onError } = options
  const instanceId = crypto.randomUUID()
  const initId = crypto.randomUUID()
  const pending = new Map<string, Command>()
  let connected = false
  let active = false

  function receive(event: MessageEvent<unknown>): void {
    if (
      event.origin !== origin ||
      event.source !== getTarget() ||
      !isEnvelope(event.data) ||
      event.data.instanceId !== instanceId
    ) {
      return
    }

    const message = event.data
    if (message.type === 'ready' && message.requestId === initId && message.payload.installationId === installationId) {
      connected = true
      onReady()
    } else if (active && message.type === 'opened' && pending.get(message.requestId) === 'open') {
      pending.delete(message.requestId)
      onOpened()
    } else if (active && message.type === 'closed' &&
      (pending.get(message.requestId) === 'close' || message.payload.reason === 'dismiss')) {
      pending.delete(message.requestId)
      onClosed(message.payload)
    } else if (message.type === 'error') {
      onError(message.payload.code)
    }
  }

  return {
    get connected() { return connected },
    get pendingCount() { return pending.size },
    listen(): void {
      window.addEventListener('message', receive)
    },
    initialize(): void {
      if (connected) return onError('frame_reloaded')
      getTarget()?.postMessage(envelope('init', instanceId, initId, { installationId }), origin)
    },
    activate(): void {
      active = true
    },
    send(type: Command): void {
      const requestId = crypto.randomUUID()
      pending.set(requestId, type)
      getTarget()?.postMessage(envelope(type, instanceId, requestId, {}), origin)
    },
    destroy(): void {
      window.removeEventListener('message', receive)
      pending.clear()
    },
  }
}
