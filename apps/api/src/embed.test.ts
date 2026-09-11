import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from './app.js'
import { demoInstallations } from './embed.js'

test('embed isola A/B, aplica CSP e entrega apenas recursos públicos', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'support-hub-'))
  await mkdir(join(dir, 'assets'))
  await Promise.all([
    writeFile(join(dir, 'index.html'), '<script type="application/json">__SUPPORT_HUB_CONFIG__</script><style nonce="__NONCE__">:root{--brand:__COLOR__}</style>'),
    writeFile(join(dir, 'loader.js'), 'void 0'), writeFile(join(dir, 'loader.css'), ':host{}'),
    writeFile(join(dir, 'assets/index-ABCDEFGH.js'), 'void 0'),
  ])
  const app = buildApp({ logger: false, widgetDir: dir, loaderDir: dir })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  for (const installation of demoInstallations.slice(0, 2)) {
    const result = await app.inject(`/embed/${installation.installationId}`)
    assert.equal(result.statusCode, 200)
    assert.match(result.body, new RegExp(installation.name.replace('&', '\\\\u0026')))
    assert.ok(result.body.includes(installation.companyId))
    assert.ok(!result.body.includes('"active"'))
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.match(String(result.headers['content-security-policy']), /frame-ancestors http:\/\/localhost:4174/)
    assert.equal(result.headers['x-frame-options'], undefined)
    assert.ok(!result.body.includes('__NONCE__'))
  }
  for (const [id, status] of [['unknown', 404], ['inst_disabled', 403]] as const) {
    const result = await app.inject(`/embed/${id}`)
    assert.equal(result.statusCode, status)
    assert.equal(result.headers['content-security-policy'], "frame-ancestors 'none'")
    assert.ok(!result.body.includes('Aurora'))
  }
  const loader = await app.inject('/loader.js')
  assert.equal(loader.statusCode, 200)
  assert.equal(loader.headers['cache-control'], 'public, max-age=0, must-revalidate')
  const asset = await app.inject('/assets/index-ABCDEFGH.js')
  assert.equal(asset.statusCode, 200)
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable')
  for (const url of ['/assets/index-ABCDEFGH.map', '/assets/missing.js', '/embed', '/chatbot']) assert.equal((await app.inject(url)).statusCode, 404)
})

test('build ausente falha explicitamente e produção não autoriza fixtures HTTP', async t => {
  const app = buildApp({ logger: false, widgetDir: '/nonexistent', loaderDir: '/nonexistent' })
  const production = buildApp({ logger: false, production: true })
  t.after(async () => { await app.close(); await production.close() })
  assert.equal((await app.inject('/embed/inst_demo_a')).statusCode, 503)
  assert.equal((await app.inject('/loader.js')).statusCode, 503)
  assert.equal((await production.inject('/embed/inst_demo_a')).statusCode, 404)
  assert.throws(() => buildApp({ logger: false, production: true, installations: demoInstallations }), /inválida/)
  assert.throws(() => buildApp({ logger: false, installations: [demoInstallations[0]!, demoInstallations[0]!] }), /inválida/)
})
