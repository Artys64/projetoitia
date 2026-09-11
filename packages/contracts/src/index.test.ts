import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envelope, isAllowedOrigin, isEnvelope, isPublicInstallation } from './index.js'

test('protocolo valida payloads, versão, limites e chaves extras', () => {
  for (const type of ['open', 'close', 'opened'] as const) assert.ok(isEnvelope(envelope(type, 'instance', 'request', {})))
  const init = envelope('init', 'instance', 'request', { installationId: 'inst_demo_a' })
  assert.ok(isEnvelope(init))
  for (const invalid of [null, [], {}, { ...init, version: 2 }, { ...init, extra: true }, { ...init, instanceId: 'x'.repeat(81) }, { ...init, payload: { installationId: 'x', other: 1 } }, { ...init, type: 'unknown' }, { ...init, payload: 'text' }, { ...init, type: 'closed', payload: { reason: 'arbitrary' } }]) assert.equal(isEnvelope(invalid), false)
  assert.equal(isEnvelope(envelope('error', 'i', 'r', { code: 'bad', message: 'a'.repeat(241) })), false)
})

test('origens são completas e HTTP só é permitido para desenvolvimento local', () => {
  assert.ok(isAllowedOrigin('https://example.com:8443'))
  assert.ok(isAllowedOrigin('http://localhost:4174', true))
  for (const origin of ['http://localhost:4174', 'http://example.com', 'https://*.example.com', 'https://example.com/path', 'https://user@example.com', 'null', 'https://example.com/']) assert.equal(isAllowedOrigin(origin), false, origin)
})

test('configuração rejeita conteúdo ativo e CSS arbitrário', () => {
  const config = { installationId: 'a', companyId: 'a', name: 'Aurora', greeting: 'Olá!', color: '#123456', allowedOrigins: ['https://example.com'] }
  assert.ok(isPublicInstallation(config))
  assert.equal(isPublicInstallation({ ...config, name: '<script>alert(1)</script>' }), false)
  assert.equal(isPublicInstallation({ ...config, color: 'red;display:none' }), false)
  assert.equal(isPublicInstallation({ ...config, allowedOrigins: [] }), false)
})
