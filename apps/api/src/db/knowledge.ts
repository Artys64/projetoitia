import type { Article } from '../ia/knowledge/repository.js'
import { createTextSearch, type KnowledgeSearch } from '../ia/knowledge/search.js'
import type { Database } from './database.js'

/** Loads the currently published knowledge for the requested tenant on every search. */
export function createPostgresKnowledgeSearch(database: Database): KnowledgeSearch {
  return async (query, companyId) => database.transaction(companyId, async sql => {
    const rows = (await sql.query(`
      SELECT a.id, a.tenant_id, v.version, v.title, v.content, v.keywords, v.suggestions
      FROM articles a
      JOIN article_versions v
        ON v.tenant_id = a.tenant_id
       AND v.article_id = a.id
       AND v.version = a.published_version
      WHERE a.tenant_id = $1
    `, [companyId])).rows
    const articles: Article[] = rows.map(row => ({
      id: row.id,
      companyId: row.tenant_id,
      version: row.version,
      status: 'published',
      title: row.title,
      content: row.content,
      keywords: row.keywords,
      suggestions: row.suggestions,
    }))
    return createTextSearch(articles)(query, companyId)
  })
}
