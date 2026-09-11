import { envelope, isEnvelope, type PublicInstallation } from '@support-hub/contracts'

type ParentChannelOptions = Pick<PublicInstallation, 'installationId' | 'allowedOrigins'> & {
  onOpen: () => void
  onDismiss: () => void
}

type ParentSession = {
  origin: string
  instanceId: string
}

// O canal cuida do protocolo e da sessão; os callbacks cuidam da interface.
export function connectParent(hostWindow: Window, options: ParentChannelOptions) {
  const { installationId, allowedOrigins, onOpen, onDismiss } = options
  let session: ParentSession | null = null
  let opened = false

  function handleMessage(event: MessageEvent<unknown>): void {
    if (
      hostWindow.parent === hostWindow ||
      event.source !== hostWindow.parent ||
      !allowedOrigins.includes(event.origin) ||
      !isEnvelope(event.data)
    ) {
      return
    }

    const message = event.data

    if (message.type === 'init') {
      if (
        message.payload.installationId !== installationId ||
        (session && message.instanceId !== session.instanceId)
      ) {
        return
      }

      session = { origin: event.origin, instanceId: message.instanceId }
      hostWindow.parent.postMessage(
        envelope('ready', session.instanceId, message.requestId, { installationId }),
        session.origin,
      )
      return
    }

    if (
      !session ||
      message.instanceId !== session.instanceId ||
      event.origin !== session.origin
    ) {
      return
    }

    switch (message.type) {
      case 'open':
        opened = true
        onOpen()
        hostWindow.parent.postMessage(
          envelope('opened', session.instanceId, message.requestId, {}),
          session.origin,
        )
        break
      case 'close':
        opened = false
        hostWindow.parent.postMessage(
          envelope('closed', session.instanceId, message.requestId, { reason: 'command' }),
          session.origin,
        )
        break
    }
  }

  function dismiss(): void {
    if (!opened || !session) return

    opened = false
    onDismiss()
    hostWindow.parent.postMessage(
      envelope('closed', session.instanceId, hostWindow.crypto.randomUUID(), { reason: 'dismiss' }),
      session.origin,
    )
  }

  hostWindow.addEventListener('message', handleMessage)

  return {
    dismiss,
    destroy: () => hostWindow.removeEventListener('message', handleMessage),
  }
}
