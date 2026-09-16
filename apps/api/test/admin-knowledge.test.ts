import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from '../src/app.js'
import { createPostgresKnowledgeSearch } from '../src/db/knowledge.js'
import { issueAdminSession } from '../src/db/admin.js'
import { KnowledgeIndexer } from '../src/db/knowledge-indexer.js'
import type { EmbeddingProvider } from '../src/ia/embeddings/provider.js'
import { testDatabase } from './helpers.js'

const origin = 'http://localhost:5173'

test('painel administra texto e Markdown sem misturar empresas ou rascunhos', async t => {
  const fixture = await testDatabase()
  t.after(() => fixture.close())
  const credentialA = await issueAdminSession(fixture.admin, 'company_a')
  const credentialB = await issueAdminSession(fixture.admin, 'company_b')
  const app = buildApp({ database: fixture.db, logger: false, adminOrigin: origin, embeddingProvider: fixture.embeddings })
  const search = createPostgresKnowledgeSearch(fixture.db, fixture.embeddings)
  t.after(() => app.close())

  assert.equal((await app.inject('/api/admin/session')).statusCode, 401)
  assert.equal((await app.inject({
    method: 'POST', url: '/api/admin/login', payload: { token: credentialA.token },
  })).statusCode, 403)

  const loginA = await app.inject({
    method: 'POST', url: '/api/admin/login', headers: { origin }, payload: { token: credentialA.token },
  })
  assert.equal(loginA.statusCode, 200)
  const cookieA = loginA.headers['set-cookie']!.split(';')[0]!

  const created = await app.inject({
    method: 'POST', url: '/api/admin/knowledge', headers: { origin, cookie: cookieA },
    payload: {
      title: 'Política de troca', format: 'markdown', sourceName: 'trocas.md',
      content: '# Trocas\n\nA empresa A aceita trocas em até 30 dias.',
    },
  })
  assert.equal(created.statusCode, 201)
  const draft = created.json()
  assert.equal(draft.draftRevision, 1)
  assert.equal(draft.publishedVersion, null)
  assert.equal((await search('trocas', 'company_a')).length, 0)

  const published = await app.inject({
    method: 'POST', url: `/api/admin/knowledge/${draft.id}/publish`,
    headers: { origin, cookie: cookieA }, payload: { expectedRevision: 1 },
  })
  assert.equal(published.statusCode, 202)
  await fixture.indexer.tick()
  assert.match((await search('30 dias', 'company_a')).map(hit => hit.text).join('\n'), /30 dias/)
  assert.equal((await search('trocas', 'company_b')).length, 0)

  const edited = await app.inject({
    method: 'PUT', url: `/api/admin/knowledge/${draft.id}`,
    headers: { origin, cookie: cookieA }, payload: {
      title: 'Política de troca', format: 'markdown', sourceName: 'trocas.md', expectedRevision: 1,
      content: '# Trocas\n\nA empresa A aceita trocas em até 45 dias.',
    },
  })
  assert.equal(edited.statusCode, 200)
  assert.equal(edited.json().hasUnpublishedChanges, true)
  assert.match((await search('30 dias', 'company_a')).map(hit => hit.text).join('\n'), /30 dias/)
  const stale = await app.inject({
    method: 'PUT', url: `/api/admin/knowledge/${draft.id}`,
    headers: { origin, cookie: cookieA }, payload: {
      title: 'Conflito', format: 'text', sourceName: null, expectedRevision: 1, content: 'Não deve vencer.',
    },
  })
  assert.equal(stale.statusCode, 409)

  const loginB = await app.inject({
    method: 'POST', url: '/api/admin/login', headers: { origin }, payload: { token: credentialB.token },
  })
  const cookieB = loginB.headers['set-cookie']!.split(';')[0]!
  const listB = await app.inject({ method: 'GET', url: '/api/admin/knowledge', headers: { cookie: cookieB } })
  assert.equal(listB.statusCode, 200)
  assert.ok(!listB.body.includes('Política de troca'))
  assert.equal((await app.inject({
    method: 'POST', url: `/api/admin/knowledge/${draft.id}/unpublish`,
    headers: { origin, cookie: cookieB }, payload: {},
  })).statusCode, 404)

  const republished = await app.inject({
    method: 'POST', url: `/api/admin/knowledge/${draft.id}/publish`,
    headers: { origin, cookie: cookieA }, payload: { expectedRevision: 2 },
  })
  assert.equal(republished.statusCode, 202)
  const failingEmbeddings: EmbeddingProvider = {
    profileId: fixture.embeddings.profileId,
    async embed() { throw new Error('embedding_unavailable') },
  }
  await new KnowledgeIndexer(fixture.db, failingEmbeddings).tick()
  assert.match((await search('30 dias', 'company_a')).map(hit => hit.text).join('\n'), /30 dias/)
  assert.equal((await search('45 dias', 'company_a')).length, 0)
  await fixture.admin.pool.query(`UPDATE knowledge_index_jobs SET available_at=now()
    WHERE publication_id=(SELECT id FROM knowledge_publications
      WHERE tenant_id=$1 AND article_id=$2 AND article_version=2)`, ['company_a', draft.id])
  await fixture.indexer.tick()
  assert.match((await search('45 dias', 'company_a')).map(hit => hit.text).join('\n'), /45 dias/)

  const unpublished = await app.inject({
    method: 'POST', url: `/api/admin/knowledge/${draft.id}/unpublish`,
    headers: { origin, cookie: cookieA }, payload: {},
  })
  assert.equal(unpublished.statusCode, 200)
  assert.equal((await search('trocas', 'company_a')).length, 0)

  const publishedForDeletion = await app.inject({
    method: 'POST', url: `/api/admin/knowledge/${draft.id}/publish`,
    headers: { origin, cookie: cookieA }, payload: { expectedRevision: 2 },
  })
  assert.equal(publishedForDeletion.statusCode, 202)
  await fixture.indexer.tick()
  assert.match((await search('45 dias', 'company_a')).map(hit => hit.text).join('\n'), /45 dias/)

  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/admin/knowledge/${draft.id}`,
    headers: { origin, cookie: cookieB },
  })).statusCode, 404)
  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/admin/knowledge/${draft.id}`,
    headers: { origin, cookie: cookieA },
  })).statusCode, 204)
  assert.equal((await search('trocas', 'company_a')).length, 0)
  const deletedRows = await fixture.admin.pool.query(`
    SELECT
      (SELECT count(*) FROM articles WHERE tenant_id=$1 AND id=$2) AS articles,
      (SELECT count(*) FROM article_drafts WHERE tenant_id=$1 AND article_id=$2) AS drafts,
      (SELECT count(*) FROM article_versions WHERE tenant_id=$1 AND article_id=$2) AS versions
  `, ['company_a', draft.id])
  assert.deepEqual(deletedRows.rows[0], { articles: '0', drafts: '0', versions: '0' })
  const listA = await app.inject({ method: 'GET', url: '/api/admin/knowledge', headers: { cookie: cookieA } })
  assert.ok(!listA.body.includes('Política de troca'))
  assert.equal((await app.inject({
    method: 'DELETE', url: `/api/admin/knowledge/${draft.id}`,
    headers: { origin, cookie: cookieA },
  })).statusCode, 404)
})
