import { ChatClient } from './chat-client'
import type { PublicInstallation } from '@support-hub/contracts'
import { mountNavigation } from './navigation'
import { connectParent } from './parent-channel'
import { renderShell } from './shell'

export function mountWidget(root: HTMLElement, config: PublicInstallation, widgetWindow: Window) {
  let chat: ChatClient | undefined
  const { region, closeButton, navigationButtons } = renderShell(root, config.name)
  const unmountNavigation = mountNavigation({
    root,
    region,
    buttons: navigationButtons,
    greeting: config.greeting,
    getChat: () => chat,
  })

  const channel = connectParent(widgetWindow, {
    onReady: origin => { if (config.chatEnabled) chat = new ChatClient(config.installationId, origin) },
    installationId: config.installationId,
    allowedOrigins: config.allowedOrigins,
    onOpen: () => { region.focus(); widgetWindow.dispatchEvent(new Event('supporthub:open')) },
    onDismiss: () => {
      const activeElement = root.ownerDocument.activeElement
      if (activeElement instanceof HTMLElement) activeElement.blur()
    },
  })

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return

    event.preventDefault()
    channel.dismiss()
  }

  closeButton.addEventListener('click', channel.dismiss)
  widgetWindow.addEventListener('keydown', handleKeydown)

  return {
    destroy() {
      unmountNavigation()
      channel.destroy()
      closeButton.removeEventListener('click', channel.dismiss)
      widgetWindow.removeEventListener('keydown', handleKeydown)
    },
  }
}
