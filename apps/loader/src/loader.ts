import { createEvents, type LoaderApi } from './events'
import { createView } from './view'
import { createWidgetChannel, type Command } from './widget-channel'

const COMMAND_LIMIT = 20
const INITIALIZATION_TIMEOUT_MS = 10_000

type QueuedCommand = { type: Command; focus: Element | null }

// Coordinate lifecycle and command policy; DOM and protocol stay in their modules.
export function createLoader(origin: string, installationId: string) {
  const events = createEvents()
  const queued: QueuedCommand[] = []
  let ready = false
  let failed = false
  let styled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const view = createView({
    origin,
    installationId,
    onStylesheetLoad: () => {
      styled = true
      activate()
    },
    onFrameLoad: () => channel.initialize(),
    onError: fail,
    onToggle: opener => command(view.opened ? 'close' : 'open', opener),
  })

  const channel = createWidgetChannel({
    origin,
    installationId,
    getTarget: view.getTarget,
    onReady: activate,
    onOpened: () => events.emit('opened', {}),
    onClosed: payload => {
      if (payload.reason === 'dismiss') view.close()
      events.emit('closed', payload)
    },
    onError: fail,
  })

  function fail(code: string): void {
    if (failed) return

    failed = true
    clearTimeout(timer)
    channel.destroy()
    document.removeEventListener('DOMContentLoaded', mount)
    view.destroy()
    queued.length = 0
    events.report(code)
  }

  function command(type: Command, focus: Element | null = document.activeElement): void {
    if (failed) return events.report('unavailable')

    if (!ready) {
      if (queued.length === COMMAND_LIMIT) return events.report('queue_full')
      queued.push({ type, focus })
      return
    }

    if (channel.pendingCount >= COMMAND_LIMIT) return events.report('queue_full')
    if (type === 'open') view.open(focus)
    else view.close()
    channel.send(type)
  }

  function activate(): void {
    if (ready || !styled || !channel.connected || failed) return

    clearTimeout(timer)
    ready = true
    channel.activate()
    view.showLauncher()
    events.emit('ready', { installationId })
    queued.splice(0).forEach(item => command(item.type, item.focus))
  }

  function mount(): void {
    if (failed) return
    channel.listen()
    view.mount()
  }

  const api: LoaderApi = {
    open: () => command('open'),
    close: () => command('close'),
    on: events.on,
    off: events.off,
  }

  return {
    api,
    report: events.report,
    start(): void {
      timer = setTimeout(() => fail('initialization_timeout'), INITIALIZATION_TIMEOUT_MS)
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true })
      } else {
        mount()
      }
    },
  }
}
