import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testDatabase } from './helpers.js'
import { prepareDemo } from '../src/db/demo.js'
import { buildApp } from '../src/app.js'

test('preparação da demo habilita chat e mantém artigos separados e sessões existentes', async () => {
  const fixture = await testDatabase()
  const app = buildApp({ database: fixture.db, logger: false })
  try {
    await prepareDemo(fixture.admin)
    const response = await app.inject({
      method: 'POST', url: '/api/widget/sessions',
      payload: { installationId: 'inst_demo_a' },
    })
    assert.equal(response.statusCode, 200)
    const before = (await fixture.admin.pool.query('SELECT id FROM visitor_sessions')).rows
    await prepareDemo(fixture.admin)
    assert.deepEqual((await fixture.admin.pool.query('SELECT id FROM visitor_sessions')).rows, before)
    for (const [tenant, expected] of [['company_a', '9h às 18h'], ['company_b', '8h às 16h']] as const) {
      await fixture.db.transaction(tenant, async sql => {
        const articles = (await sql.query("SELECT tenant_id,content FROM article_versions WHERE article_id='demo-horario-atendimento'")).rows
        assert.equal(articles.length, 1)
        assert.equal(articles[0].tenant_id, tenant)
        assert.ok(articles[0].content.includes(expected))
      })
    }
    const embed = await app.inject('/embed/inst_demo_a')
    assert.equal(embed.statusCode, 200)
    assert.match(embed.body, /"chatEnabled":true/)
    assert.equal((await app.inject('/embed/inst_disabled')).statusCode, 403)
    await fixture.admin.pool.query("DELETE FROM schema_migrations WHERE name='003_generated_publication.sql'")
    await assert.rejects(prepareDemo(fixture.admin), /Migração pendente ou alterada: 003_generated_publication.sql/)
  } finally {
    await app.close()
    await fixture.close()
  }
})
