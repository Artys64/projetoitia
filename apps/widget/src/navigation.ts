import { renderHelp } from './views/help'
import { renderHome } from './views/home'
import { renderMessages } from './views/messages'

type View = 'home' | 'messages' | 'help'

type NavigationOptions = {
  root: HTMLElement
  region: HTMLElement
  buttons: NodeListOf<HTMLButtonElement>
  greeting: string
}

function isView(value: string | undefined): value is View {
  return value === 'home' || value === 'messages' || value === 'help'
}

export function mountNavigation({ root, region, buttons, greeting }: NavigationOptions) {
  let currentView: View = 'home'

  function render(): void {
    switch (currentView) {
      case 'home':
        renderHome(region, greeting)
        break
      case 'messages':
        renderMessages(region)
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

  return () => root.removeEventListener('click', handleClick)
}
