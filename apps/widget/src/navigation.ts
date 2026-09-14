import type { ChatClient } from './chat-client'
import { renderHelp } from './tela/help'
import { renderHome } from './tela/home'
import { renderMessages } from './tela/messages'

type View = 'home' | 'messages' | 'help'

type NavigationOptions = {
  root: HTMLElement
  region: HTMLElement
  buttons: NodeListOf<HTMLButtonElement>
  getChat?: () => ChatClient | undefined
  greeting: string
}

function isView(value: string | undefined): value is View {
  return value === 'home' || value === 'messages' || value === 'help'
}

export function mountNavigation({ root, region, buttons, greeting, getChat }: NavigationOptions) {
  let currentView: View = 'home'
  let cleanup: (() => void) | undefined

  function render(): void {
    cleanup?.()
    cleanup = undefined
    switch (currentView) {
      case 'home':
        renderHome(region, greeting)
        break
      case 'messages':
        cleanup = renderMessages(region, getChat?.())
        break
      case 'help':
        renderHelp(region)
        break
    }

    buttons.forEach(button => {
      if (button.dataset.view === currentView) {
        button.setAttribute('aria-current', 'page')
      } else {
        button.removeAttribute('aria-current')
      }
    })
  }

  function handleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return

    const button = event.target.closest<HTMLButtonElement>('button')
    const nextView = button?.dataset.view ?? button?.dataset.go

    if (!isView(nextView)) return

    currentView = nextView
    render()
    region.focus()
  }

  render()
  root.addEventListener('click', handleClick)

  return () => { cleanup?.(); root.removeEventListener('click', handleClick) }
}
