type ViewOptions = {
  origin: string
  installationId: string
  onStylesheetLoad: () => void
  onFrameLoad: () => void
  onError: (code: string) => void
  onToggle: (opener: HTMLElement) => void
}

export function createView(options: ViewOptions) {
  const host = document.createElement('support-hub-root')
  const shadow = host.attachShadow({ mode: 'open' })
  const stylesheet = document.createElement('link')
  const button = document.createElement('button')
  const frame = document.createElement('iframe')
  let opened = false
  let opener: HTMLElement | null = null

  stylesheet.rel = 'stylesheet'
  stylesheet.href = `${options.origin}/loader.css`
  stylesheet.onload = options.onStylesheetLoad
  stylesheet.onerror = () => options.onError('stylesheet_failed')

  button.type = 'button'
  button.textContent = 'Fale com a gente'
  button.hidden = true
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'support-hub-frame')
  button.onclick = () => options.onToggle(button)

  frame.id = 'support-hub-frame'
  frame.title = 'Central de suporte'
  frame.hidden = true
  frame.tabIndex = -1
  frame.referrerPolicy = 'strict-origin'
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.onload = options.onFrameLoad
  frame.onerror = () => options.onError('frame_failed')

  function restoreFocus(): void {
    frame.blur()
    if (opener?.isConnected) opener.focus()
    else if (button.isConnected && !button.hidden) button.focus()
  }

  function open(focus: Element | null): void {
    if (!opened) opener = focus instanceof HTMLElement ? focus : null

    // Release the old document focus before crossing origins (Firefox).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    opened = true
    frame.hidden = false
    frame.tabIndex = 0
    button.setAttribute('aria-expanded', 'true')
    frame.focus()
  }

  function close(): void {
    const shouldRestoreFocus = opened
    opened = false
    frame.hidden = true
    frame.tabIndex = -1
    button.setAttribute('aria-expanded', 'false')

    // Restore after the hidden iframe has left the rendered focus tree.
    if (shouldRestoreFocus) {
      requestAnimationFrame(() => {
        if (!opened && (document.activeElement === document.body || document.activeElement === host)) {
          restoreFocus()
        }
      })
    }
  }

  return {
    open,
    close,
    get opened() { return opened },
    getTarget: () => frame.contentWindow,
    mount(): void {
      frame.src = `${options.origin}/embed/${encodeURIComponent(options.installationId)}`
      shadow.append(stylesheet, button, frame)
      document.body.append(host)
    },
    showLauncher(): void {
      button.hidden = false
    },
    destroy(): void {
      if (opened) restoreFocus()
      host.remove()
    },
  }
}
