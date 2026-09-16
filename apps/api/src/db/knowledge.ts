import type { Database } from './database.js'
import { validateEmbeddingBatch, type EmbeddingProvider } from '../ia/embeddings/provider.js'
import type { KnowledgeSearch, SearchHit } from '../ia/knowledge/search.js'

const MAX_CACHE = 256

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map(value => Number(value).toString()).join(',')}]`
}

/** Indexed hybrid retrieval. SQL filters tenant and active publication before either ranking. */
export function createPostgresKnowledgeSearch(database: Database, embeddings: EmbeddingProvider): KnowledgeSearch {
  const cache = new Map<string, number[]>()
  return async (query, companyId, options) => {
    const normalized = query.trim()
    if (!normalized) return []
    const cacheKey = `${companyId}\0${embeddings.profileId}\0${normalized}`
    let vector = cache.get(cacheKey)
    if (!vector) {
      const batch = validateEmbeddingBatch(
        await embeddings.embed([normalized], 'query', options?.signal), 1,
      )
      vector = batch.vectors[0]
      if (!vector) throw new Error('embedding_batch_incomplete')
      cache.set(cacheKey, vector)
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
    }
    return database.transaction(companyId, async sql => {
      await sql.query("SET LOCAL statement_timeout='1500ms'")
      const result = await sql.query(`
        WITH config AS (
          SELECT profile_id,semantic_min_similarity FROM knowledge_retrieval_configs
          WHERE tenant_id=$1 AND strategy='hybrid'
        ), query AS (
          SELECT websearch_to_tsquery('portuguese',$2) AS lexical,$3::vector(384) AS semantic
        ), eligible AS MATERIALIZED (
          SELECT c.index_set_id,c.chunk_index,c.article_id,c.article_version,c.title,c.text,
            c.literal_hash,c.search_vector,e.embedding
          FROM config cfg
          JOIN articles a ON a.tenant_id=$1 AND a.published_version IS NOT NULL
            AND a.active_index_set_id IS NOT NULL
          JOIN knowledge_index_sets s ON s.tenant_id=a.tenant_id AND s.id=a.active_index_set_id
            AND s.article_id=a.id AND s.article_version=a.published_version
            AND s.profile_id=cfg.profile_id AND s.state='active'
          JOIN knowledge_chunks c ON c.tenant_id=s.tenant_id AND c.index_set_id=s.id
          JOIN knowledge_embeddings e ON e.tenant_id=c.tenant_id AND e.index_set_id=c.index_set_id
            AND e.chunk_index=c.chunk_index AND e.profile_id=cfg.profile_id
        ), lexical AS (
          SELECT index_set_id,chunk_index,
            row_number() OVER (ORDER BY ts_rank_cd(search_vector,q.lexical) DESC,article_id,chunk_index) AS position
          FROM eligible CROSS JOIN query q WHERE search_vector @@ q.lexical
          ORDER BY ts_rank_cd(search_vector,q.lexical) DESC,article_id,chunk_index LIMIT 20
        ), semantic AS (
          SELECT index_set_id,chunk_index,
            row_number() OVER (ORDER BY embedding <=> q.semantic,article_id,chunk_index) AS position
          FROM eligible CROSS JOIN query q CROSS JOIN config cfg
          WHERE 1-(embedding <=> q.semantic)>=cfg.semantic_min_similarity
          ORDER BY embedding <=> q.semantic,article_id,chunk_index LIMIT 20
        ), fused AS (
          SELECT index_set_id,chunk_index,sum(score) AS score FROM (
            SELECT index_set_id,chunk_index,1.0/(60+position) AS score FROM lexical
            UNION ALL
            SELECT index_set_id,chunk_index,1.0/(60+position) AS score FROM semantic
          ) ranked GROUP BY index_set_id,chunk_index
        )
        SELECT e.*,f.score FROM fused f JOIN eligible e USING(index_set_id,chunk_index)
        ORDER BY f.score DESC,e.article_id,e.chunk_index LIMIT 8
      `, [companyId, normalized, vectorLiteral(vector)])
      return result.rows.map((row): SearchHit => ({
        companyId, articleId: row.article_id, version: row.article_version,
        title: row.title, chunk: row.chunk_index, text: row.text, suggestions: [],
        score: Number(row.score), indexSetId: row.index_set_id, literalHash: row.literal_hash,
      }))
    })
  }
}
