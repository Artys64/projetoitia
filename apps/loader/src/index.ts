import { envelope, isEnvelope, type Payloads } from '@support-hub/contracts'
type EventName = 'ready' | 'opened' | 'closed' | 'error'
type Callback = (payload: Payloads[EventName]) => void
type Api = { open(): void; close(): void; on(event: EventName, callback: Callback): void; off(event: EventName, callback: Callback): void }
declare global { interface Window { SupportHub?: Api } }
const script = document.currentScript as HTMLScriptElement | null
const installationId = script?.dataset.installationId ?? ''
const registry = Symbol.for('support-hub.loader.v1')
const globals = window as unknown as Record<symbol, { installationId: string; api: Api; report: (code: string) => void } | undefined>
function reportGlobal(code: string) {
  window.dispatchEvent(new CustomEvent('supporthub:error', { detail: { code, message: 'Não foi possível iniciar a central de suporte.' } }))
  console.error('[SupportHub]', code)
}
function start() {
  const existing = globals[registry]
  if (existing) {
    if (existing.installationId !== installationId) existing.report('installation_conflict')
    return
  }
  if (window.SupportHub !== undefined) return reportGlobal('global_conflict')
  if (!script || !/^[a-zA-Z0-9_-]{1,80}$/.test(installationId)) return reportGlobal('invalid_installation')
  const origin = new URL(script.src).origin
  const instanceId = crypto.randomUUID()
  const initId = crypto.randomUUID()
  const listeners = new Map<EventName, Set<Callback>>()
  const queued: { type: 'open' | 'close'; focus: Element | null }[] = []
  const pending = new Map<string, 'open' | 'close'>()
  let ready = false, failed = false, opened = false, styled = false, connected = false
  let opener: HTMLElement | null = null
  let host: HTMLElement, frame: HTMLIFrameElement, button: HTMLButtonElement
  let timer: ReturnType<typeof setTimeout>
  function emit(event: EventName, payload: Payloads[EventName]) {
    listeners.get(event)?.forEach(callback => { try { callback(payload) } catch (error) { console.error(error) } })
  }
  function report(code: string) {
    emit('error', { code, message: 'Não foi possível usar a central de suporte.' })
    reportGlobal(code)
  }
  function restoreFocus() {
    frame?.blur()
    if (opener?.isConnected) opener.focus()
    else if (button?.isConnected && !button.hidden) button.focus()
  }
  function fail(code: string) {
    if (failed) return
    failed = true
    clearTimeout(timer)
    window.removeEventListener('message', receive)
    document.removeEventListener('DOMContentLoaded', mount)
    if (opened) restoreFocus()
    host?.remove()
    queued.length = 0
    pending.clear()
    report(code)
  }
  function hide() {
    const restore = opened
    opened = false
    frame.hidden = true; frame.tabIndex = -1
    button.setAttribute('aria-expanded', 'false')
    // Restore after the hidden iframe has left the rendered focus tree.
    if (restore) requestAnimationFrame(() => {
      if (!opened && (document.activeElement === document.body || document.activeElement === host)) restoreFocus()
    })
  }
  function command(type: 'open' | 'close', focus: Element | null = document.activeElement) {
    if (failed) return report('unavailable')
    if (!ready) {
      if (queued.length === 20) return report('queue_full')
      queued.push({ type, focus }); return
    }
    if (pending.size >= 20) return report('queue_full')
    if (type === 'open') {
      if (!opened) opener = focus instanceof HTMLElement ? focus : null
      // Release the old document focus before crossing origins (Firefox).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      opened = true
      frame.hidden = false
      frame.tabIndex = 0
      button.setAttribute('aria-expanded', 'true')
      frame.focus()
    } else hide()
    const requestId = crypto.randomUUID()
    pending.set(requestId, type)
    frame.contentWindow?.postMessage(envelope(type, instanceId, requestId, {}), origin)
  }
  function activate() {
    if (ready || !styled || !connected || failed) return
    clearTimeout(timer)
    ready = true
    button.hidden = false
    emit('ready', { installationId })
    queued.splice(0).forEach(item => command(item.type, item.focus))
  }
  function receive(event: MessageEvent) {
    if (event.origin !== origin || event.source !== frame?.contentWindow || !isEnvelope(event.data) || event.data.instanceId !== instanceId) return
    const message = event.data
    if (message.type === 'ready' && message.requestId === initId && message.payload.installationId === installationId) {
      connected = true; activate()
    } else if (ready && message.type === 'opened' && pending.get(message.requestId) === 'open') {
      pending.delete(message.requestId); emit('opened', {})
    } else if (ready && message.type === 'closed' &&
      (pending.get(message.requestId) === 'close' || message.payload.reason === 'dismiss')) {
      pending.delete(message.requestId)
      if (message.payload.reason === 'dismiss') hide()
      emit('closed', message.payload)
    } else if (message.type === 'error') fail(message.payload.code)
  }
  const api: Api = {
    open: () => command('open'), close: () => command('close'),
    on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback) },
    off: (event, callback) => { listeners.get(event)?.delete(callback) },
  }
  window.SupportHub = api
  globals[registry] = { installationId, api, report }
  function mount() {
    if (failed) return
    host = document.createElement('support-hub-root')
    const shadow = host.attachShadow({ mode: 'open' })
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = `${origin}/loader.css`
    css.onload = () => { styled = true; activate() }
    css.onerror = () => fail('stylesheet_failed')
    button = document.createElement('button')
    button.type = 'button'; button.textContent = 'Fale com a gente'; button.hidden = true
    button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'support-hub-frame')
    button.onclick = () => command(opened ? 'close' : 'open', button)
    frame = document.createElement('iframe')
    frame.id = 'support-hub-frame'; frame.title = 'Central de suporte'
    frame.hidden = true; frame.tabIndex = -1
    frame.referrerPolicy = 'strict-origin'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.onload = () => {
      if (connected) return fail('frame_reloaded')
      frame.contentWindow?.postMessage(envelope('init', instanceId, initId, { installationId }), origin)
    }
    frame.onerror = () => fail('frame_failed')
    window.addEventListener('message', receive)
    frame.src = `${origin}/embed/${encodeURIComponent(installationId)}`
    shadow.append(css, button, frame)
    document.body.append(host)
  }
  timer = setTimeout(() => fail('initialization_timeout'), 10_000)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}
start()
