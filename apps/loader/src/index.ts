import { reportGlobalError, type LoaderApi } from './events'
import { createLoader } from './loader'

declare global {
  interface Window {
    SupportHub?: LoaderApi
  }
}

type RegisteredLoader = {
  installationId: string
  api: LoaderApi
  report: (code: string) => void
}

const registry = Symbol.for('support-hub.loader.v1')
const globals = window as unknown as Record<symbol, RegisteredLoader | undefined>

function start(script: HTMLScriptElement | null): void {
  const installationId = script?.dataset.installationId ?? ''
  const existing = globals[registry]

  if (existing) {
    if (existing.installationId !== installationId) existing.report('installation_conflict')
    return
  }

  if (window.SupportHub !== undefined) return reportGlobalError('global_conflict')
  if (!script || !/^[a-zA-Z0-9_-]{1,80}$/.test(installationId)) {
    return reportGlobalError('invalid_installation')
  }

  const loader = createLoader(new URL(script.src).origin, installationId)
  window.SupportHub = loader.api
  globals[registry] = { installationId, api: loader.api, report: loader.report }
  loader.start()
}

// Capture the classic script while it is executing, before waiting for the DOM.
start(document.currentScript as HTMLScriptElement | null)
