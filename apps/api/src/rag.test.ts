import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLanguageModelV4 } from 'ai/test'
import { buildApp } from './app.js'
import { createTextSearch } from './ia/knowledge/search.js'
import { loadArticles, type Article } from './ia/knowledge/repository.js'

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

function lookup(query: string, id = 'lookup-1') {
  return {
    ...generation(''),
    content: [{ type: 'tool-call' as const, toolCallId: id, toolName: 'searchKnowledge', input: JSON.stringify({ query }) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
  }
}

test('envia trechos recuperados ao modelo e mantém reply/suggestions', async context => {
  const model = new MockLanguageModelV4({ doGenerate: [lookup('Como exportar?'), generation('Você pode exportar em CSV.')] })
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: createTextSearch([
    article,
    { ...article, id: 'privado', status: 'draft', content: 'SEGREDO RASCUNHO' },
    { ...article, companyId: 'outra', content: 'SEGREDO OUTRA EMPRESA' },
  ]) })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?', companyId: 'outra' } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { reply: 'Você pode exportar em CSV.', suggestions: article.suggestions })
  assert.equal(model.doGenerateCalls.length, 2)
  assert.doesNotMatch(JSON.stringify(model.doGenerateCalls[0]?.prompt), /arquivo CSV/)
  const prompt = JSON.stringify(model.doGenerateCalls[1]?.prompt)
  assert.match(prompt, /arquivo CSV/)
  assert.match(prompt, /exportacao/)
  assert.doesNotMatch(prompt, /SEGREDO|Esqueci minha senha/)
})

test('busca sem resultado chega ao modelo para esclarecer a dúvida; consulta não herda assunto antigo', async context => {
  const answer = 'Não encontrei informação sobre essa integração. Qual sistema você pretende conectar?'
  const model = new MockLanguageModelV4({ doGenerate: [lookup('Integração com ERP'), generation(answer)] })
  const queries: string[] = []
  const search = createTextSearch([article])
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async (query, companyId) => {
    queries.push(query)
    return search(query, companyId)
  } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages: [
    { role: 'user', content: 'Como exportar?' },
    { role: 'assistant', content: article.content },
    { role: 'user', content: 'Vocês têm integração com ERP?' },
  ] } })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().reply, answer)
  assert.deepEqual(queries, ['Integração com ERP'])
  assert.equal(model.doGenerateCalls.length, 2)
  const toolResults = model.doGenerateCalls[1]?.prompt.filter(message => message.role === 'tool')
  assert.match(JSON.stringify(toolResults), /not_found/)
  assert.doesNotMatch(JSON.stringify(toolResults), /arquivo CSV/)
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

test('falha da ferramenta retorna 503 sem gerar resposta após a falha', async context => {
  const model = new MockLanguageModelV4({ doGenerate: lookup('Como exportar?') })
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async () => { throw new Error('indisponível') } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
  assert.equal(response.statusCode, 503)
  assert.equal(model.doGenerateCalls.length, 1)
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

test('modo local continua respondendo perguntas com trechos literais', async context => {
  const app = buildApp({ logger: false, useLlm: false })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Qual foi o horário de atendimento?' } })
  assert.match(response.json().reply, /8h às 18h/)
  const human = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Falar com uma pessoa' } })
  assert.match(human.json().reply, /ainda não registra pedidos/)
})

test('respostas curtas e sociais chegam ao modelo com histórico sem busca obrigatória', async context => {
  for (const message of ['não', 'sim', 'obrigada', 'oi', 'prefiro deixar para outra hora']) {
    const answer = 'Tudo bem, estou por aqui se precisar.'
    const model = new MockLanguageModelV4({ doGenerate: generation(answer) })
    let searches = 0
    const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async () => { searches++; return [] } })
    context.after(() => app.close())
    const messages = [
      { role: 'assistant', content: 'Quer ajuda com mais alguma coisa?' },
      { role: 'user', content: message },
    ]
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages } })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { reply: answer, suggestions: [] })
    assert.equal(searches, 0)
    assert.equal(model.doGenerateCalls.length, 1)
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    assert.match(prompt, /Quer ajuda com mais alguma coisa/)
    assert.ok(prompt.includes(message))
  }
})

test('negativa contextual permite ao modelo consultar a dúvida completa na empresa do servidor', async context => {
  const model = new MockLanguageModelV4({ doGenerate: [lookup('Não recebi o e-mail de recuperação de senha'), generation('Confira as pastas de spam e promoções.')] })
  const queries: Array<[string, string]> = []
  const search = createTextSearch(loadArticles())
  const app = buildApp({ logger: false, languageModel: model, knowledgeCompanyId: 'support-hub', knowledgeSearch: async (query, companyId) => {
    queries.push([query, companyId])
    return search(query, companyId)
  } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { companyId: 'outra', messages: [
    { role: 'user', content: 'Esqueci minha senha' },
    { role: 'assistant', content: 'Você recebeu o e-mail de recuperação?' },
    { role: 'user', content: 'não' },
  ] } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(queries, [['Não recebi o e-mail de recuperação de senha', 'support-hub']])
  assert.match(JSON.stringify(model.doGenerateCalls[0]?.prompt), /Você recebeu o e-mail de recuperação/)
  assert.match(JSON.stringify(model.doGenerateCalls[1]?.prompt), /pastas de spam/)
})

test('permite reformular uma busca vazia e força resposta na terceira etapa', async context => {
  const model = new MockLanguageModelV4({ doGenerate: [lookup('baixar dados'), lookup('exportar relatórios', 'lookup-2'), generation('Use Exportar para obter o CSV.')] })
  const queries: string[] = []
  const search = createTextSearch([article])
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async (query, companyId) => {
    queries.push(query)
    return search(query, companyId)
  } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como baixar meus dados?' } })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(queries, ['baixar dados', 'exportar relatórios'])
  assert.equal(model.doGenerateCalls.length, 3)
  assert.deepEqual(model.doGenerateCalls[2]?.toolChoice, { type: 'none' })
  assert.match(JSON.stringify(model.doGenerateCalls[2]?.prompt), /arquivo CSV/)
  assert.deepEqual(response.json().suggestions, article.suggestions)
})

test('limite de buscas também vale para várias chamadas na mesma etapa', async context => {
  const model = new MockLanguageModelV4({ doGenerate: [{
    ...lookup('exportar'),
    content: ['a', 'b', 'c'].flatMap(id => lookup('exportar', id).content),
  }, generation('Não encontrei orientações de exportação na base.')] })
  let searches = 0
  const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async () => { searches++; return [] } })
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
  assert.equal(response.statusCode, 200)
  assert.equal(searches, 2)
  assert.deepEqual(model.doGenerateCalls[1]?.toolChoice, { type: 'none' })
  assert.match(JSON.stringify(model.doGenerateCalls[1]?.prompt), /limit_reached/)
})

test('argumentos inválidos da ferramenta não chegam à busca', async context => {
  for (const input of [{ query: ' ' }, { query: 'x'.repeat(501) }, { query: 'exportar', companyId: 'outra' }]) {
    const call = lookup('exportar')
    const model = new MockLanguageModelV4({ doGenerate: [{
      ...call, content: call.content.map(part => ({ ...part, input: JSON.stringify(input) })),
    }, generation('Pode esclarecer o que você deseja consultar?')] })
    let searches = 0
    const app = buildApp({ logger: false, languageModel: model, knowledgeSearch: async () => { searches++; return [] } })
    context.after(() => app.close())
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Como exportar?' } })
    assert.equal(response.statusCode, 200)
    assert.equal(searches, 0)
    assert.equal(model.doGenerateCalls.length, 2)
  }
})
