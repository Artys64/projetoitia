import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadArticles, validateArticles, type Article } from './knowledge/repository.js'
import { createTextSearch, retrievalQuery, splitContent } from './knowledge/search.js'
import { buildContext, MAX_CONTEXT_CHARS } from './knowledge/context.js'

const article: Article = {
  id: 'exportacao', companyId: 'a', version: 2, status: 'published',
  title: 'Exportação de relatórios', keywords: ['exportar', 'relatorio'],
  content: 'Você pode exportar relatórios em CSV pela área de relatórios.', suggestions: [],
}

test('recupera os assuntos conhecidos e recusa uma pergunta fora da base', async () => {
  const search = createTextSearch(loadArticles())
  const cases = [
    ['Esqueci minha senha', 'redefinir-senha'],
    ['Não recebi o e-mail', 'email-nao-recebido'],
    ['Quais são os planos?', 'planos'],
    ['Como instalar o widget?', 'instalar-widget'],
    ['Horário de atendimento', 'horario-atendimento'],
  ]
  for (const [query, id] of cases) {
    assert.equal((await search(query!, 'support-hub'))[0]?.articleId, id, query)
  }
  assert.deepEqual(await search('Qual a previsão do tempo amanhã?', 'support-hub'), [])
  assert.deepEqual(await search('e de para com', 'support-hub'), [])
})

test('exclui rascunhos e empresas diferentes antes da busca', async () => {
  const search = createTextSearch([
    article,
    { ...article, id: 'rascunho', status: 'draft', content: 'SEGREDO EM RASCUNHO' },
    { ...article, companyId: 'b', content: 'SEGREDO DA EMPRESA B' },
  ])
  const hits = await search('exportar relatórios', 'a')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.text, article.content)
  assert.deepEqual(await search('exportar relatórios', 'c'), [])
})

test('carrega artigos personalizados e rejeita arquivos malformados ou duplicados', context => {
  const directory = mkdtempSync(join(tmpdir(), 'support-hub-knowledge-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'articles.json')
  writeFileSync(path, JSON.stringify([article]))
  assert.deepEqual(loadArticles(path), [article])
  writeFileSync(path, '{')
  assert.throws(() => loadArticles(path))
  assert.throws(() => validateArticles([{ ...article, status: 'private' }]))
  assert.throws(() => validateArticles([article, article]), /duplicado/)
})

test('divide conteúdo longo e limita o JSON completo do contexto', async () => {
  const content = 'Uma orientação de exportação. '.repeat(500)
  const chunks = splitContent(content)
  assert.ok(chunks.length > 4)
  assert.ok(chunks.every(chunk => chunk.length <= 900))
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), content.trim())
  assert.ok(splitContent('x'.repeat(2000)).every(chunk => chunk.length <= 900))
  const search = createTextSearch([{ ...article, content }])
  const result = buildContext(await search('exportação', 'a'))
  assert.ok(result.sources.length > 0 && result.sources.length <= 4)
  assert.ok(result.context.length <= MAX_CONTEXT_CHARS)
  assert.equal(JSON.parse(result.context).length, result.sources.length)
  const huge = { ...result.sources[0]!, text: 'x'.repeat(MAX_CONTEXT_CHARS) }
  assert.deepEqual(buildContext([huge]).sources, [])
})

test('usa a pergunta anterior em continuação explícita sem usar fatos do assistente', () => {
  const history = [
    { role: 'user', content: 'Esqueci minha senha' },
    { role: 'assistant', content: 'FATO INVENTADO' },
    { role: 'user', content: 'E quanto tempo dura?' },
  ]
  assert.match(retrievalQuery(history), /senha/)
  assert.doesNotMatch(retrievalQuery(history), /INVENTADO/)
  assert.equal(retrievalQuery([...history, { role: 'user', content: 'Qual a previsão do tempo?' }]), 'Qual a previsão do tempo?')
})
