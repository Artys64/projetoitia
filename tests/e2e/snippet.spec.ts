import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
test.beforeAll(async ({ request }) => {
  // Reusing a user server is opt-in and must verify it serves this build.
  const loader = await request.get('http://localhost:3000/loader.js')
  expect(loader.status()).toBe(200)
  expect(await loader.text()).toBe(await readFile('apps/loader/dist/loader.js', 'utf8'))
  const embed = await request.get('http://localhost:3000/embed/inst_demo_a')
  expect(embed.status()).toBe(200)
  expect(await embed.text()).toContain('Aurora Studio')
})
const widget = (page: Page) => page.frameLocator('support-hub-root iframe')
const launcher = (page: Page) => page.getByRole('button', { name: 'Fale com a gente' })
async function ready(page: Page, path = '/a.html') {
  await page.goto(path)
  await expect(launcher(page)).toBeVisible()
}
async function addSnippet(page: Page, id: string) {
  await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'http://localhost:3000/loader.js'
    script.dataset.installationId = id
    script.onload = () => resolve()
    script.onerror = reject
    document.head.append(script)
  }), id)
}

test('empresa correta, navegação persistente, teclado e host intacto', async ({ page, browser }, info) => {
  info.annotations.push({ type: 'browser-version', description: browser.version() })
  const violations: string[] = []
  page.on('console', message => { if (message.type() === 'error') violations.push(message.text()) })
  await ready(page)
  const initialUrl = page.url()
  await page.locator('#open').focus()
  await page.keyboard.press('Enter')
  await expect(widget(page).locator('#company')).toHaveText('Aurora Studio')
  // Verify keyboard actually reaches the central, independent of which inner
  // element the browser chooses as its initial focus target.
  await page.keyboard.press('Escape')
  await expect(page.locator('support-hub-root iframe')).toBeHidden()
  await expect(page.locator('#open')).toBeFocused()
  await page.keyboard.press('Enter')
  await widget(page).getByRole('button', { name: 'Mensagens', exact: true }).click()
  await expect(widget(page).getByText('Nenhuma conversa por aqui')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('support-hub-root iframe')).toBeHidden()
  await expect(page.locator('#open')).toBeFocused()
  await launcher(page).click()
  await expect(widget(page).getByText('Nenhuma conversa por aqui')).toBeVisible()
  await widget(page).getByRole('button', { name: 'Ajuda', exact: true }).click()
  await widget(page).getByText('Como funciona esta central?').click()
  await expect(widget(page).getByText(/Use Início, Mensagens e Ajuda/)).toBeVisible()
  const frameBox = await page.locator('support-hub-root iframe').boundingBox()
  const viewport = page.viewportSize()!
  expect(frameBox!.x).toBeGreaterThanOrEqual(0)
  expect(frameBox!.y).toBeGreaterThanOrEqual(0)
  expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(viewport.width)
  expect(frameBox!.y + frameBox!.height).toBeLessThanOrEqual(viewport.height)
  await widget(page).getByRole('button', { name: 'Fechar central' }).click()
  await expect(launcher(page)).toBeFocused()
  await page.locator('#counter').click()
  await expect(page.locator('#counter')).toHaveText('Contador: 1')
  await page.getByLabel('Seu nome').fill('Yana')
  await page.getByRole('button', { name: 'Testar formulário' }).click()
  await expect(page.locator('#form-result')).toHaveText('Recebido nesta página: Yana')
  expect(page.url()).toBe(initialUrl)
  await page.getByRole('link', { name: 'Continuar pela página' }).click()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100)
  await page.goto('/b.html')
  await launcher(page).click()
  await expect(widget(page).locator('#company')).toHaveText('Jardim & Casa')
  await expect(widget(page).locator('header')).toHaveCSS('background-color', 'rgb(50, 100, 77)')
  await page.setViewportSize({ width: 320, height: 568 })
  await expect(widget(page).getByRole('button', { name: 'Fechar central' })).toBeInViewport()
  // WebKit screenshot preparation injects a temporary 'body {}' stylesheet.
  // Check application logs before that capture-only CSP violation.
  expect(violations).toEqual([])
  await page.screenshot({ path: info.outputPath('widget.png'), caret: 'initial' })
})

test('snippet duplicado, conflito explícito, fila e off', async ({ page }) => {
  await page.route('**/embed/inst_demo_a', async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.continue() })
  await page.goto('/without.html')
  await addSnippet(page, 'inst_demo_a')
  await page.evaluate(() => {
    const api = (window as any).SupportHub
    const callback = () => { (window as any).removedListenerRan = true }
    api.on('opened', callback); api.off('opened', callback)
    api.open(); api.close(); api.open()
  })
  await expect(launcher(page)).toBeVisible()
  await expect(widget(page).locator('#company')).toBeVisible()
  await addSnippet(page, 'inst_demo_a')
  await expect(page.locator('support-hub-root')).toHaveCount(1)
  await addSnippet(page, 'inst_demo_b')
  await expect(page.locator('#events')).toContainText('installation_conflict')
  await expect(widget(page).locator('#company')).toHaveText('Aurora Studio')
  expect(await page.evaluate(() => (window as any).removedListenerRan)).toBeUndefined()
})

test('origem/janela/envelope forjados não alteram o estado', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.origin === 'http://localhost:3000' && event.data?.type === 'ready') (window as any).widgetReady = event.data
    })
  })
  await ready(page)
  await page.evaluate(() => {
    const frame = document.querySelector('support-hub-root')!.shadowRoot!.querySelector('iframe')!
    const data = { ...(window as any).widgetReady, type: 'error', payload: { code: 'forged', message: 'Mensagem forjada' } }
    const dispatch = (origin: string, source: Window | null, payload: unknown) => {
      const event = new MessageEvent('message', { origin, data: payload })
      // Firefox disallows cross-origin WindowProxy in MessageEventInit. Set the
      // synthetic source explicitly to exercise the same receiver checks.
      Object.defineProperty(event, 'source', { value: source })
      window.dispatchEvent(event)
    }
    dispatch('http://localhost:3000', window, data)
    dispatch('https://evil.example', frame.contentWindow, data)
    dispatch('http://localhost:3000', frame.contentWindow, { ...data, version: 2 })
    frame.contentWindow!.postMessage({ ...data, instanceId: 'fake', type: 'open', payload: {} }, 'http://localhost:3000')
  })
  await expect(page.locator('support-hub-root iframe')).toBeHidden()
  await launcher(page).click()
  await expect(widget(page).locator('#company')).toHaveText('Aurora Studio')
})

for (const scenario of ['unknown', 'disabled', 'forbidden', 'blocked', 'network', 'css'] as const) {
  test(`falha ${scenario} é observável e remove elementos inativos`, async ({ page }) => {
    if (scenario === 'blocked') await page.route('**/embed/**', route => route.fulfill({ status: 200, headers: { 'Content-Security-Policy': "frame-ancestors 'none'" }, body: '<!doctype html><title>Bloqueado</title>' }))
    if (scenario === 'network') await page.route('**/embed/**', route => route.abort())
    if (scenario === 'css') await page.route('**/loader.css', route => route.abort())
    const origin = scenario === 'forbidden' ? 'http://127.0.0.1:4174' : 'http://localhost:4174'
    await page.goto(`${origin}/without.html`)
    await page.clock.install()
    await addSnippet(page, scenario === 'unknown' ? 'unknown' : scenario === 'disabled' ? 'inst_disabled' : 'inst_demo_a')
    await page.clock.fastForward(11_000)
    await expect(page.locator('#events')).toContainText('Erro:')
    await expect(page.locator('support-hub-root')).toHaveCount(0)
    await page.locator('#counter').click()
    await expect(page.locator('#counter')).toHaveText('Contador: 1')
  })
}

test('global preexistente é preservado e fila tem limite', async ({ page }) => {
  await page.goto('/without.html')
  await page.evaluate(() => { (window as any).SupportHub = { custom: true } })
  await addSnippet(page, 'inst_demo_a')
  await expect(page.locator('#events')).toContainText('global_conflict')
  expect(await page.evaluate(() => (window as any).SupportHub.custom)).toBe(true)
  await expect(page.locator('support-hub-root')).toHaveCount(0)
  await page.reload()
  await page.route('**/embed/**', route => route.abort())
  await addSnippet(page, 'inst_demo_a')
  await page.evaluate(() => { for (let i = 0; i < 21; i++) (window as any).SupportHub.open() })
  await expect(page.locator('#events')).toContainText('queue_full')
})

test('fechar devolve foco ao botão quando o acionador foi removido', async ({ page }) => {
  await ready(page)
  await page.locator('#open').click()
  await page.locator('#open').evaluate(node => node.remove())
  await widget(page).getByRole('button', { name: 'Fechar central' }).click()
  await expect(launcher(page)).toBeFocused()
})

test('comparação com/sem snippet preserva geometria e estilos do host', async ({ page }, info) => {
  await page.addInitScript(() => {
    const entries: unknown[] = []
    ;(window as any).longTasks = entries
    ;(window as any).longTasksSupported = PerformanceObserver.supportedEntryTypes.includes('longtask')
    if ((window as any).longTasksSupported) new PerformanceObserver(list => entries.push(...list.getEntries().map(entry => entry.toJSON()))).observe({ type: 'longtask', buffered: true })
  })
  const geometry = () => page.evaluate(() => Array.from(document.querySelectorAll('header, main, h1, #counter, form, #more, footer')).map(node => {
    const box = node.getBoundingClientRect(), css = getComputedStyle(node)
    return { tag: node.tagName, x: box.x, y: box.y, width: box.width, height: box.height, color: css.color, background: css.backgroundColor, font: css.font, margin: css.margin }
  }))
  await page.route('**/loader.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('/a.html')
  const before = await geometry()
  const baseline = await page.evaluate(() => ({ supported: (window as any).longTasksSupported, tasks: (window as any).longTasks }))
  await page.unroute('**/loader.js')
  await ready(page)
  expect(await geometry()).toEqual(before)
  const after = await page.evaluate(() => ({ supported: (window as any).longTasksSupported, tasks: (window as any).longTasks }))
  await info.attach('host-performance', { body: JSON.stringify({ baseline, snippet: after }, null, 2), contentType: 'application/json' })
})
