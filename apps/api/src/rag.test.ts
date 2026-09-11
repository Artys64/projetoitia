import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLanguageModelV4 } from 'ai/test'
import { buildApp } from './app.js'
import { createTextSearch } from './knowledge/search.js'
import type { Article } from './knowledge/repository.js'

const article: Article = {
  id: 'exportacao', companyId: 'support-hub', version: 3, status: 'published',
  title: 'Exportação', keywords: ['exportar', 'relatorio'],
  content: 'Use o botão Exportar para obter um arquivo CSV.', suggestions: ['Voltar ao início'],
}

function generation(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    }, warnings: [],
  }
}

test('envia trechos recuperados ao modelo e mantém reply/suggestions', async context => {
  const model = new MockLanguageModelV4({ doGenerate: generation('Você pode exportar em CSV.') })
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: createTextSearch([
    article,
    { ...article, id: 'privado', status: 'draft', content: 'SEGREDO RASCUNHO' },
    { ...article, companyId: 'outra', content: 'SEGREDO OUTRA EMPRESA' },
  ]) })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?', companyId: 'outra' } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { reply: 'Você pode exportar em CSV.', suggestions: article.suggestions })
  assert.equal(model.doGenerateCalls.length, 1)
  const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
  assert.match(prompt, /arquivo CSV/)
  assert.match(prompt, /exportacao/)
  assert.doesNotMatch(prompt, /SEGREDO|Esqueci minha senha/)
})

test('não chama o modelo quando não há fonte; novo assunto não herda fonte antiga', async context => {
  const model = new MockLanguageModelV4({ doGenerate: generation('Não deveria ser gerado') })
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: createTextSearch([article]) })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages: [
    { role: 'user', content: 'Como exportar?' },
    { role: 'assistant', content: article.content },
    { role: 'user', content: 'Qual a previsão do tempo amanhã?' },
  ] } })
  assert.equal(response.statusCode, 200)
  assert.match(response.json().reply, /não encontrei uma resposta segura/)
  assert.equal(model.doGenerateCalls.length, 0)
})

test('modo local usa a base personalizada e aceita sua resposta no próximo turno', async context => {
  const longArticle = { ...article, content: 'Exportar em CSV. '.repeat(45) }
  const app = buildApp({ logger: false, useLlm: false, knowledgeSearch: createTextSearch([longArticle]) })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().reply, longArticle.content.trim())
  const next = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages: [
    { role: 'user', content: 'Como exportar?' },
    { role: 'assistant', content: response.json().reply },
    { role: 'user', content: 'Como exportar?' },
  ] } })
  assert.equal(next.statusCode, 200)
})

test('falha de busca retorna 503 sem chamar o modelo', async context => {
  const model = new MockLanguageModelV4({ doGenerate: generation('Não deveria ser gerado') })
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async () => { throw new Error('indisponível') } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
  assert.equal(response.statusCode, 503)
  assert.equal(model.doGenerateCalls.length, 0)
})

test('resposta vazia usa fallback e falha do provedor retorna 502', async context => {
  for (const failing of [false, true]) {
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (failing) throw new Error('falha simulada')
      return generation(' ')
    } })
    const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: createTextSearch([article]) })
    context.after(() => app.close())
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
    assert.equal(response.statusCode, failing ? 502 : 200)
    if (!failing) assert.match(response.json().reply, /não encontrei/)
  }
})

test('saudação não intercepta perguntas e atendimento não finge encaminhamento', async context => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Qual foi o horário de atendimento?' } })
  assert.match(response.json().reply, /8h às 18h/)
  const human = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Falar com uma pessoa' } })
  assert.match(human.json().reply, /ainda não encaminha/)
})
