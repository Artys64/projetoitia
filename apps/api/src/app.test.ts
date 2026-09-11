import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from './app.js'

test('GET /api/health informa que a API está saudável', async (context) => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'support-hub-api',
    timestamp: response.json().timestamp,
  })
})

test('POST /api/chat responde a uma dúvida de acesso', async (context) => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message: 'Esqueci minha senha' },
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.json().reply, /redefinir sua senha/i)
  assert.ok(Array.isArray(response.json().suggestions))
})

test('POST /api/chat rejeita mensagem vazia', async (context) => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message: '   ' },
  })

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.json(), {
    error: 'Envie uma conversa válida com mensagens de usuário de até 500 caracteres.',
  })
})

test('POST /api/chat aceita o histórico da conversa', async (context) => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: {
      messages: [
        { role: 'assistant', content: 'Como posso ajudar?' },
        { role: 'user', content: 'Quais são os planos?' },
      ],
    },
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.json().reply, /equipes de diferentes tamanhos/i)
})
