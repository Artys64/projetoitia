import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { buildApp } from '../src/app.js'
import { AdminSessionStore } from '../src/db/admin-sessions.js'
import { Database } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { ChatStore, digest } from '../src/db/store.js'
import { adminCookieName } from '../src/middlewares/admin-access.js'
import { testDatabase } from './helpers.js'

test('acesso HTTP: sessões reais de usuário e admin com isolamento no PostgreSQL', async t => {
  const f = await testDatabase(); t.after(() => f.close())
  const app = buildApp({ database: f.db, production: true, logger: false, adminOrigin: 'https://painel.example.com' })
  t.after(() => app.close())
  const userId = randomUUID()
  await f.admin.pool.query('INSERT INTO admin_users(id) VALUES($1)', [userId])
  for (const tenant of ['company_a', 'company_b']) {
    await f.admin.pool.query('INSERT INTO admin_memberships(tenant_id,user_id) VALUES($1,$2)', [tenant, userId])
  }
  async function session(tenant: string) {
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    await f.admin.pool.query(`INSERT INTO admin_sessions(id,tenant_id,user_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 hour')`, [id, tenant, userId, digest(token)])
    return { id, token, headers: { cookie: `${adminCookieName(true)}=${token}` } }
  }
  const a = await session('company_a'), b = await session('company_b')
  const visitor = (await app.inject({ method: 'POST', url: '/api/widget/sessions', payload: { installationId: 'inst_demo_a' } })).json()
  assert.equal(typeof visitor.token, 'string')

  await t.test('login e logout emitem cookies compatíveis com a proteção administrativa em produção', async () => {
    const disposable = await session('company_a')
    const origin = 'https://painel.example.com'
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/login', payload: { token: disposable.token } })).statusCode, 403)
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', headers: { origin }, payload: { token: disposable.token } })
    assert.equal(login.statusCode, 200)
    const cookie = String(login.headers['set-cookie'])
    assert.ok(cookie.startsWith(`${adminCookieName(true)}=${disposable.token};`))
    assert.match(cookie, /; Path=\/;/)
    assert.match(cookie, /; HttpOnly;/)
    assert.match(cookie, /; SameSite=Strict;/)
    assert.match(cookie, /; Secure(?:;|$)/)
    assert.doesNotMatch(cookie, /Domain=/i)
    const headers = { cookie: cookie.split(';')[0]!, origin }
    assert.equal((await app.inject({ url: '/api/admin/session', headers })).statusCode, 200)
    const logout = await app.inject({ method: 'DELETE', url: '/api/admin/session', headers })
    assert.equal(logout.statusCode, 204)
    assert.match(String(logout.headers['set-cookie']), /; Path=\/;/)
    assert.match(String(logout.headers['set-cookie']), /; Max-Age=0(?:;|$)/)
    assert.equal((await app.inject({ url: '/api/admin/session', headers })).statusCode, 401)
  })

  await t.test('rotas exigem sua própria sessão e não aceitam credenciais ou perfis trocados', async () => {
    assert.equal((await app.inject('/api/admin/session')).statusCode, 401)
    assert.equal((await app.inject('/api/widget/conversations')).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/admin/session', headers: { authorization: `Bearer ${visitor.token}`, 'x-role': 'admin' } })).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/admin/session', headers: { cookie: `${adminCookieName(true)}=${visitor.token}` } })).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/widget/conversations', headers: { authorization: `Bearer ${a.token}` } })).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/widget/conversations', headers: a.headers })).statusCode, 401)
    const state = await app.inject({ url: '/api/widget/session', headers: { authorization: `Bearer ${visitor.token}` } })
    assert.deepEqual(state.json(), { role: 'user', companyId: 'company_a', installationId: 'inst_demo_a' })
    assert.equal((await app.inject({ method: 'POST', url: '/api/widget/conversations', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode, 401)
  })

  await t.test('empresa vem da sessão e requisições simultâneas não compartilham contexto', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => app.inject({ url: '/api/admin/session', headers: i % 2 ? b.headers : a.headers })))
    for (const [i, response] of responses.entries()) {
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), { role: 'admin', companyId: i % 2 ? 'company_b' : 'company_a', userId })
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.ok(!response.body.includes(a.token)); assert.ok(!response.body.includes(digest(a.token)))
    }
    assert.equal((await app.inject({ url: '/api/admin/session?companyId=company_b&role=admin', headers: a.headers })).statusCode, 400)
    assert.equal((await app.inject({ url: '/api/widget/session?companyId=company_b', headers: { authorization: `Bearer ${visitor.token}` } })).statusCode, 400)
  })

  await t.test('revogação, expiração, associação e desativação são verificadas a cada acesso', async () => {
    const revoked = await session('company_a'), expired = await session('company_a')
    await f.admin.pool.query('UPDATE admin_sessions SET revoked_at=now() WHERE id=$1', [revoked.id])
    await f.admin.pool.query("UPDATE admin_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id])
    for (const headers of [revoked.headers, expired.headers]) assert.equal((await app.inject({ url: '/api/admin/session', headers })).statusCode, 401)
    for (const [disable, restore, values] of [
      ['UPDATE admin_users SET active=false WHERE id=$1', 'UPDATE admin_users SET active=true WHERE id=$1', [userId]],
      ["UPDATE admin_memberships SET active=false WHERE user_id=$1 AND tenant_id='company_a'", "UPDATE admin_memberships SET active=true WHERE user_id=$1 AND tenant_id='company_a'", [userId]],
      ["UPDATE tenants SET active=false WHERE id='company_a'", "UPDATE tenants SET active=true WHERE id='company_a'", []],
    ] as const) {
      await f.admin.pool.query(disable, [...values])
      assert.equal((await app.inject({ url: '/api/admin/session', headers: a.headers })).statusCode, 403)
      await f.admin.pool.query(restore, [...values])
      assert.equal((await app.inject({ url: '/api/admin/session', headers: a.headers })).statusCode, 200)
    }
    await new ChatStore(f.db).revoke(visitor.token)
    assert.equal((await app.inject({ url: '/api/widget/session', headers: { authorization: `Bearer ${visitor.token}` } })).statusCode, 401)
  })

  await t.test('RLS e permissões mínimas impedem leitura sem sessão e criação de administradores pelo runtime', async () => {
    const single = new Database(f.runtimeUrl, 1)
    try {
      const sessions = new AdminSessionStore(single)
      assert.equal((await sessions.authenticate(a.token)).companyId, 'company_a')
      assert.equal((await sessions.authenticate(b.token)).companyId, 'company_b')
      await assert.rejects(sessions.authenticate(randomBytes(32).toString('base64url')), { statusCode: 401 })
      for (const table of ['admin_sessions', 'admin_users', 'admin_memberships']) {
        assert.equal((await single.pool.query(`SELECT * FROM ${table}`)).rowCount, 0)
      }
      await single.transaction('company_a', async sql => {
        assert.equal((await sql.query('SELECT * FROM admin_sessions')).rowCount, 0)
        assert.equal((await sql.query('SELECT * FROM admin_memberships')).rowCount, 0)
      })
      await assert.rejects(single.pool.query('INSERT INTO admin_users(id) VALUES($1)', [randomUUID()]), { code: '42501' })
      await assert.rejects(single.pool.query('UPDATE admin_memberships SET active=true'), { code: '42501' })
      await assert.rejects(f.admin.pool.query(`INSERT INTO admin_sessions(id,tenant_id,user_id,token_hash,expires_at)
        VALUES($1,'company_a',$2,$3,now()+interval '1 hour')`, [randomUUID(), randomUUID(), digest('invalid membership')]), { code: '23503' })
      await migrate(f.admin)
    } finally { await single.close() }
  })
})
