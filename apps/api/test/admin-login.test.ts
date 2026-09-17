import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from '../src/app.js'
import { createAdminAccount } from '../src/db/admin.js'
import { createPostgresKnowledgeSearch } from '../src/db/knowledge.js'
import { testDatabase } from './helpers.js'
import { createDemoHost } from '../../demo-host/server.mjs'

const origin = 'http://localhost:4174'
const password = 'Uma senha local de teste!'

test('login com senha pelo hospedeiro protege e publica o contexto da empresa', async t => {
  const fixture = await testDatabase()
  t.after(() => fixture.close())
  const account = await createAdminAccount(fixture.admin, 'company_a', 'admin', password)
  await createAdminAccount(fixture.admin, 'company_b', 'admin-b', password)
  const app = buildApp({ database: fixture.db, adminOrigin: origin, logger: false, embeddingProvider: fixture.embeddings })
  const apiOrigin = await app.listen({ port: 0, host: '127.0.0.1' })
  const host = createDemoHost({ apiOrigin })
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve))
  const hostUrl = `http://127.0.0.1:${(host.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => host.close(() => resolve())); await app.close() })
  const call = (path: string, method = 'GET', body?: unknown, cookie?: string, requestOrigin = origin) => fetch(`${hostUrl}${path}`, {
    method, headers: { origin: requestOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const login = (username = 'admin', secret = password) => call('/api/admin/login', 'POST', { username, password: secret })

  await t.test('rota e assets existem, sem expor fontes ou credenciais', async () => {
    for (const path of ['/admin', '/admin/']) {
      const response = await call(path)
      assert.equal(response.status, 200)
      const html = await response.text()
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)]
      assert.ok(assets.length >= 2)
      for (const asset of assets) assert.equal((await call(asset[1]!)).status, 200)
    }
    for (const path of ['/.env', '/src/main.tsx', '/assets/../.env', '/admin/no-such-route']) {
      assert.equal((await call(path)).status, 404)
    }
  })

  await t.test('nega anônimos, senha incorreta e origem não autorizada', async () => {
    assert.equal((await call('/api/admin/knowledge')).status, 401)
    assert.equal((await call('/api/admin/knowledge', 'POST', {})).status, 401)
    const wrong = await login('admin', 'senha incorreta')
    const unknown = await login('desconhecido', password)
    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    assert.deepEqual(await wrong.json(), await unknown.json())
    assert.equal(wrong.headers.get('set-cookie'), null)
    assert.equal((await call('/api/admin/login', 'POST', { username: 'admin', password }, undefined, 'http://outro.example')).status, 403)
  })

  let cookie = ''
  await t.test('cria sessão opaca e usa o conhecimento somente depois de publicado', async () => {
    const response = await login(' ADMIN ')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).companyId, 'company_a')
    const header = response.headers.get('set-cookie')!
    assert.match(header, /HttpOnly/)
    assert.match(header, /SameSite=Strict/)
    assert.ok(!header.includes(password))
    cookie = header.split(';')[0]!
    assert.equal((await call('/api/admin/session', 'GET', undefined, cookie)).status, 200)
    const created = await call('/api/admin/knowledge', 'POST', {
      title: 'Política de trocas', content: 'A empresa A aceita trocas em até 30 dias.', format: 'text', sourceName: null,
    }, cookie)
    assert.equal(created.status, 201)
    const draft = await created.json()
    const search = createPostgresKnowledgeSearch(fixture.db, fixture.embeddings)
    assert.equal((await search('trocas', 'company_a')).length, 0)
    assert.equal((await call(`/api/admin/knowledge/${draft.id}/publish`, 'POST', { expectedRevision: 1 }, cookie)).status, 202)
    await fixture.indexer.tick()
    assert.match((await search('30 dias', 'company_a')).map(hit => hit.text).join('\n'), /30 dias/)
    assert.equal((await search('trocas', 'company_b')).length, 0)
    const other = await login('admin-b')
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!
    const list = await call('/api/admin/knowledge', 'GET', undefined, otherCookie)
    assert.ok(!(await list.text()).includes('Política de trocas'))
    assert.equal((await call('/api/admin/session?companyId=company_b', 'GET', undefined, cookie)).status, 400)
  })

  await t.test('logout revoga a sessão, novo login gera outra e acesso removido é negado', async () => {
    assert.equal((await call('/api/admin/session', 'DELETE', undefined, cookie)).status, 204)
    assert.equal((await call('/api/admin/session', 'GET', undefined, cookie)).status, 401)
    const again = await login()
    assert.equal(again.status, 200)
    const newCookie = again.headers.get('set-cookie')!.split(';')[0]!
    assert.notEqual(newCookie, cookie)
    await fixture.admin.pool.query('UPDATE admin_memberships SET active=false WHERE user_id=$1', [account.userId])
    assert.equal((await login()).status, 401)
    assert.equal((await call('/api/admin/knowledge', 'GET', undefined, newCookie)).status, 403)
    await fixture.admin.pool.query('UPDATE admin_memberships SET active=true WHERE user_id=$1', [account.userId])
  })

  await t.test('credenciais não são legíveis sem contexto nem graváveis pelo runtime', async () => {
    assert.equal((await fixture.db.pool.query('SELECT * FROM admin_credentials')).rowCount, 0)
    await assert.rejects(fixture.db.pool.query('UPDATE admin_credentials SET password_hash=$1', [password]), { code: '42501' })
    await assert.rejects(createAdminAccount(fixture.admin, 'company_b', 'admin', password), { code: '23505' })
    const stored = (await fixture.admin.pool.query('SELECT password_hash FROM admin_credentials WHERE username=$1', ['admin'])).rows[0].password_hash
    assert.match(stored, /^scrypt\$/)
    assert.ok(!stored.includes(password))
  })

  await t.test('limite de tentativas é persistente e responde 429', async () => {
    let response: Response
    do { response = await login('admin', 'incorreta') } while (response.status === 401)
    assert.equal(response.status, 429)
    assert.equal((await login()).status, 429)
  })
})
