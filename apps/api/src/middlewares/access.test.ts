import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import { AccessError, requireAdminAccess, requireUserAccess } from './access.js'
import { adminCookieName, installAdminAccess } from './admin-access.js'
import { installUserAccess } from './user-access.js'

const token = 'a'.repeat(43)
const origin = 'https://painel.example.com'

function fixture(options: { production: boolean; origin?: string } = { production: true, origin }) {
  const app = Fastify()
  let handled = 0
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AccessError) return reply.code(error.statusCode).send({ code: error.code })
    return reply.code(503).send({ code: 'unavailable' })
  })
  app.get('/public', async request => ({ protected: request.access !== undefined }))
  app.register(async api => {
    installAdminAccess(api, { async authenticate(value) {
      if (value !== token) throw new AccessError(401, 'admin_session_required', 'Entre no painel.')
      return { role: 'admin', companyId: 'company_a', userId: 'admin', sessionId: 'admin-session', credentialHash: 'fixture-hash' }
    } }, options)
    api.get('/session', async request => requireAdminAccess(request))
    api.post('/write', async request => { handled++; return requireAdminAccess(request) })
  }, { prefix: '/admin' })
  app.register(async api => {
    installUserAccess(api, { async authenticate(value) {
      if (value !== token) throw new AccessError(401, 'session_expired', 'Inicie uma sessão.')
      return { id: 'visitor-session', tenant_id: 'company_b', installation_id: 'installation_b' }
    } })
    api.get('/session', async request => requireUserAccess(request))
  }, { prefix: '/user' })
  return { app, get handled() { return handled } }
}

test('middlewares isolam os escopos e usam somente a identidade resolvida no servidor', async t => {
  const { app } = fixture(); t.after(() => app.close())
  assert.deepEqual((await app.inject('/public')).json(), { protected: false })
  assert.equal((await app.inject('/admin/session')).statusCode, 401)
  assert.equal((await app.inject('/user/session')).statusCode, 401)
  const [admin, user] = await Promise.all([
    app.inject({ url: '/admin/session?role=user&companyId=company_b', headers: { cookie: `${adminCookieName(true)}=${token}` } }),
    app.inject({ url: '/user/session?role=admin&companyId=company_a', headers: { authorization: `Bearer ${token}`, 'x-role': 'admin' } }),
  ])
  assert.equal(admin.json().role, 'admin'); assert.equal(admin.json().companyId, 'company_a')
  assert.equal(user.json().role, 'user'); assert.equal(user.json().companyId, 'company_b')
  assert.equal((await app.inject('/user/session')).statusCode, 401)
})

test('middleware administrativo exige cookie único e não aceita bearer ou cookie de desenvolvimento em produção', async t => {
  const { app } = fixture(); t.after(() => app.close())
  for (const headers of [
    { authorization: `Bearer ${token}` },
    { cookie: `support_hub_admin=${token}` },
    { cookie: `${adminCookieName(true)}=${token}; ${adminCookieName(true)}=${token}` },
    { cookie: `${adminCookieName(true)}=%61${token.slice(1)}` },
    { cookie: `${adminCookieName(true)}=invalid` },
  ]) assert.equal((await app.inject({ url: '/admin/session', headers })).statusCode, 401)
  assert.equal((await app.inject({ url: '/user/session', headers: { cookie: `${adminCookieName(true)}=${token}` } })).statusCode, 401)
  for (const authorization of [token, `Basic ${token}`, `Bearer ${token}, ${token}`]) {
    assert.equal((await app.inject({ url: '/user/session', headers: { authorization } })).statusCode, 401)
  }
})

test('origem administrativa é conferida antes de ler o corpo ou executar a operação', async t => {
  const f = fixture(); t.after(() => f.app.close())
  const cookie = `${adminCookieName(true)}=${token}`
  for (const suppliedOrigin of [undefined, 'null', 'https://outro.example.com', `${origin}.evil.com`]) {
    const result = await f.app.inject({ method: 'POST', url: '/admin/write',
      headers: { cookie, 'content-type': 'application/json', host: 'painel.example.com',
        'x-forwarded-host': 'painel.example.com', ...(suppliedOrigin ? { origin: suppliedOrigin } : {}) },
      payload: '{invalid JSON',
    })
    assert.equal(result.statusCode, 403); assert.equal(result.json().code, 'invalid_origin')
  }
  assert.equal(f.handled, 0)
  const result = await f.app.inject({ method: 'POST', url: '/admin/write', headers: { cookie, origin }, payload: { role: 'user', companyId: 'company_b' } })
  assert.equal(result.statusCode, 200); assert.equal(result.json().companyId, 'company_a'); assert.equal(f.handled, 1)
})

test('sem origem configurada escritas são bloqueadas; desenvolvimento aceita somente cookie próprio', async t => {
  const f = fixture({ production: false }); t.after(() => f.app.close())
  const headers = { cookie: `${adminCookieName(false)}=${token}`, origin: 'http://localhost:5173' }
  assert.equal((await f.app.inject({ url: '/admin/session', headers })).statusCode, 200)
  assert.equal((await f.app.inject({ method: 'POST', url: '/admin/write', headers })).statusCode, 403)
  assert.equal(f.handled, 0)
})

test('origens inválidas impedem registrar o middleware', async t => {
  for (const badOrigin of ['http://painel.example.com', `${origin}/path`, '*', 'null']) {
    const f = fixture({ production: true, origin: badOrigin }); t.after(() => f.app.close())
    await assert.rejects(f.app.ready(), /ADMIN_ORIGIN/)
  }
})
