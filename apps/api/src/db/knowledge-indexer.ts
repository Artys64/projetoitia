import { randomUUID } from 'node:crypto'
import { validateEmbeddingBatch, type EmbeddingProvider } from '../ia/embeddings/provider.js'
import {
  SPLITTER_VERSION, contentHash, embeddingInput, embeddingInputHash, splitKnowledgeDocument,
} from '../ia/knowledge/chunking.js'
import { Database, type Sql } from './database.js'

type Claim = {
  tenantId: string
  jobId: string
  publicationId: string
  leaseToken: string
  attempt: number
}

const LEASE_SECONDS = 120
const BATCH_SIZE = 16
const vector = (values: readonly number[]) => `[${values.join(',')}]`

export class KnowledgeIndexer {
  private nextTenant = 0
  constructor(readonly db: Database, readonly embeddings: EmbeddingProvider) {}

  async claim(): Promise<Claim | null> {
    const tenants = (await this.db.pool.query('SELECT id FROM tenants ORDER BY id')).rows
    for (let offset = 0; offset < tenants.length; offset++) {
      const tenantId = tenants[(this.nextTenant + offset) % tenants.length]!.id as string
      const claim = await this.db.transaction(tenantId, async sql => {
        const row = (await sql.query(`
          SELECT j.* FROM knowledge_index_jobs j
          WHERE j.available_at<=clock_timestamp()
            AND (j.state='queued' OR (j.state='running' AND j.lease_until<clock_timestamp()))
            AND j.attempts<3
          ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED
        `)).rows[0]
        if (!row) return null
        const leaseToken = randomUUID()
        const attempt = Number(row.attempts) + 1
        await sql.query(`UPDATE knowledge_index_jobs SET state='running',attempts=$3,lease_token=$4,
          lease_until=clock_timestamp()+$5*interval '1 second',updated_at=now(),error_code=NULL
          WHERE tenant_id=$1 AND id=$2`, [tenantId, row.id, attempt, leaseToken, LEASE_SECONDS])
        await sql.query(`UPDATE knowledge_publications SET state='indexing',error_code=NULL,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND state IN ('queued','indexing')`, [tenantId, row.publication_id])
        return { tenantId, jobId: row.id, publicationId: row.publication_id, leaseToken, attempt }
      })
      if (claim) {
        this.nextTenant = (this.nextTenant + offset + 1) % tenants.length
        return claim
      }
    }
    return null
  }

  private async owned(sql: Sql, claim: Claim): Promise<boolean> {
    return (await sql.query(`SELECT id FROM knowledge_index_jobs
      WHERE tenant_id=$1 AND id=$2 AND state='running' AND attempts=$3 AND lease_token=$4
        AND lease_until>clock_timestamp() FOR UPDATE`,
    [claim.tenantId, claim.jobId, claim.attempt, claim.leaseToken])).rowCount !== 0
  }

  private renewLease(claim: Claim): Promise<boolean> {
    return this.db.transaction(claim.tenantId, async sql => {
      if (!await this.owned(sql, claim)) return false
      await sql.query(`UPDATE knowledge_index_jobs
        SET lease_until=clock_timestamp()+$3*interval '1 second',updated_at=now()
        WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.jobId, LEASE_SECONDS])
      return true
    })
  }

  async execute(claim: Claim): Promise<void> {
    try {
      const source = await this.db.transaction(claim.tenantId, async sql => {
        const publication = (await sql.query(`SELECT * FROM knowledge_publications
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.publicationId])).rows[0]
        if (!publication || !await this.owned(sql, claim)) return null
        const version = (await sql.query(`SELECT v.title,v.content,
            COALESCE(d.source_format,'text') AS source_format
          FROM article_versions v LEFT JOIN article_drafts d
            ON d.tenant_id=v.tenant_id AND d.article_id=v.article_id
          WHERE v.tenant_id=$1 AND v.article_id=$2 AND v.version=$3`,
        [claim.tenantId, publication.article_id, publication.article_version])).rows[0]
        return version ? { publication, ...version } : null
      })
      if (!source) throw new Error('publication_unavailable')
      const chunks = splitKnowledgeDocument(source.content, source.source_format)
      const inputs = chunks.map(chunk => embeddingInput(source.title, chunk))
      const vectors: number[][] = []
      const tokenCounts: number[] = []
      for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
        const inputBatch = inputs.slice(start, start + BATCH_SIZE)
        const result = validateEmbeddingBatch(
          await this.embeddings.embed(inputBatch, 'passage'), inputBatch.length,
        )
        vectors.push(...result.vectors)
        tokenCounts.push(...result.tokenCounts)
        if (!await this.renewLease(claim)) throw new Error('indexing_lease_lost')
      }

      const setId = await this.db.transaction(claim.tenantId, async sql => {
        if (!await this.owned(sql, claim)) throw new Error('indexing_lease_lost')
        const publication = (await sql.query(`SELECT * FROM knowledge_publications
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [claim.tenantId, claim.publicationId])).rows[0]
        if (!publication || publication.state !== 'indexing') throw new Error('publication_changed')
        const existing = (await sql.query(`SELECT id,state FROM knowledge_index_sets
          WHERE tenant_id=$1 AND publication_id=$2 FOR UPDATE`,
        [claim.tenantId, claim.publicationId])).rows[0]
        const id = existing?.id ?? randomUUID()
        if (existing?.state === 'active') throw new Error('publication_changed')
        if (existing) {
          await sql.query(`UPDATE knowledge_index_sets SET profile_id=$3,splitter_version=$4,
            content_hash=$5,state='building',expected_chunks=$6,completed_chunks=0,activated_at=NULL
            WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, id, this.embeddings.profileId,
            SPLITTER_VERSION, contentHash(source.content), chunks.length])
          await sql.query('DELETE FROM knowledge_chunks WHERE tenant_id=$1 AND index_set_id=$2',
            [claim.tenantId, id])
        } else {
          await sql.query(`INSERT INTO knowledge_index_sets(
            tenant_id,id,publication_id,article_id,article_version,profile_id,splitter_version,
            content_hash,state,expected_chunks,completed_chunks
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'building',$9,0)`, [
            claim.tenantId, id, claim.publicationId, publication.article_id,
            publication.article_version, this.embeddings.profileId, SPLITTER_VERSION,
            contentHash(source.content), chunks.length,
          ])
        }
        await sql.query(`UPDATE knowledge_index_jobs SET completed_chunks=0,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.jobId])
        return id as string
      })

      for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
        const slice = chunks.slice(start, start + BATCH_SIZE)
        const stored = await this.db.transaction(claim.tenantId, async sql => {
          if (!await this.owned(sql, claim)) return false
          const indexSet = (await sql.query(`SELECT state FROM knowledge_index_sets
            WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [claim.tenantId, setId])).rows[0]
          if (indexSet?.state !== 'building') return false
          const values: unknown[] = []
          const rows = slice.map((chunk, local) => {
            const input = inputs[start + local]!
            const base = values.length
            values.push(claim.tenantId, setId, chunk.index, source.publication.article_id,
              source.publication.article_version, source.title, chunk.sectionTitle, chunk.text,
              tokenCounts[start + local], chunk.literalHash, embeddingInputHash(input), JSON.stringify(chunk.locator))
            return `(${Array.from({ length: 12 }, (_, index) => `$${base + index + 1}`).join(',')})`
          })
          await sql.query(`INSERT INTO knowledge_chunks(tenant_id,index_set_id,chunk_index,article_id,
            article_version,title,section_title,text,token_count,literal_hash,embedding_input_hash,locator)
            VALUES ${rows.join(',')}`, values)
          const embeddingValues: unknown[] = []
          const embeddingRows = slice.map((chunk, local) => {
            const base = embeddingValues.length
            embeddingValues.push(claim.tenantId, setId, chunk.index, this.embeddings.profileId,
              embeddingInputHash(inputs[start + local]!), vector(vectors[start + local]!))
            return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::vector(384))`
          })
          await sql.query(`INSERT INTO knowledge_embeddings(tenant_id,index_set_id,chunk_index,
            profile_id,input_hash,embedding) VALUES ${embeddingRows.join(',')}`, embeddingValues)
          await sql.query(`UPDATE knowledge_index_sets SET completed_chunks=completed_chunks+$3
            WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, setId, slice.length])
          await sql.query(`UPDATE knowledge_index_jobs SET completed_chunks=completed_chunks+$3,
            lease_until=clock_timestamp()+$4*interval '1 second',updated_at=now()
            WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.jobId, slice.length, LEASE_SECONDS])
          return true
        })
        if (!stored) throw new Error('indexing_lease_lost')
      }

      await this.db.transaction(claim.tenantId, async sql => {
        await sql.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [claim.tenantId])
        if (!await this.owned(sql, claim)) return
        const publication = (await sql.query(`SELECT * FROM knowledge_publications
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [claim.tenantId, claim.publicationId])).rows[0]
        const article = (await sql.query(`SELECT * FROM articles
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [claim.tenantId, source.publication.article_id])).rows[0]
        const indexSet = (await sql.query(`SELECT * FROM knowledge_index_sets
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [claim.tenantId, setId])).rows[0]
        if (!publication || !article || !indexSet) return
        if (publication.state !== 'indexing' || article.published_version !== publication.previous_published_version) {
          await this.supersede(sql, claim)
          return
        }
        if (indexSet.state !== 'building' || Number(indexSet.completed_chunks) !== chunks.length ||
          Number(indexSet.expected_chunks) !== chunks.length) throw new Error('index_set_incomplete')
        if (publication.draft_revision !== null) {
          const draft = (await sql.query(`SELECT revision FROM article_drafts
            WHERE tenant_id=$1 AND article_id=$2 FOR UPDATE`, [claim.tenantId, publication.article_id])).rows[0]
          if (draft?.revision !== publication.draft_revision) { await this.supersede(sql, claim); return }
        }
        if (publication.requested_by) {
          await sql.query("SELECT set_config('app.admin_user_id',$1,true)", [publication.requested_by])
          const membership = await sql.query(`SELECT m.user_id FROM admin_memberships m
            JOIN admin_users u ON u.id=m.user_id
            WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.active AND u.active`,
          [claim.tenantId, publication.requested_by])
          if (!membership.rowCount) { await this.supersede(sql, claim); return }
        }
        if (article.active_index_set_id) await sql.query(`UPDATE knowledge_index_sets SET state='retired'
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, article.active_index_set_id])
        await sql.query(`UPDATE knowledge_index_sets SET state='active',activated_at=now()
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, setId])
        await sql.query(`UPDATE articles SET published_version=$3,active_index_set_id=$4
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, publication.article_id, publication.article_version, setId])
        if (publication.draft_revision !== null) await sql.query(`UPDATE article_drafts
          SET published_revision=$3,updated_at=now() WHERE tenant_id=$1 AND article_id=$2 AND revision=$3`,
        [claim.tenantId, publication.article_id, publication.draft_revision])
        await sql.query(`INSERT INTO knowledge_retrieval_configs(tenant_id,profile_id,generation)
          VALUES($1,$2,1) ON CONFLICT(tenant_id) DO UPDATE SET profile_id=excluded.profile_id,
            generation=knowledge_retrieval_configs.generation+1,updated_at=now()`,
        [claim.tenantId, this.embeddings.profileId])
        await sql.query(`UPDATE knowledge_publications SET state='active',updated_at=now()
          WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.publicationId])
        await sql.query(`UPDATE knowledge_index_jobs SET state='completed',completed_chunks=$3,
          lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [claim.tenantId, claim.jobId, chunks.length])
      })
    } catch (error) {
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
        ? error.message : 'indexing_failed'
      await this.db.transaction(claim.tenantId, async sql => {
        const job = (await sql.query(`SELECT attempts FROM knowledge_index_jobs
          WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 FOR UPDATE`,
        [claim.tenantId, claim.jobId, claim.leaseToken])).rows[0]
        if (!job) return
        const retry = Number(job.attempts) < 3
        await sql.query(`UPDATE knowledge_index_jobs SET state=$4,error_code=$5,lease_until=NULL,
          available_at=clock_timestamp()+($6*interval '1 second'),updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND lease_token=$3`,
        [claim.tenantId, claim.jobId, claim.leaseToken, retry ? 'queued' : 'failed', code, 2 ** Number(job.attempts)])
        await sql.query(`UPDATE knowledge_publications SET state=$3,error_code=$4,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND state='indexing'`,
        [claim.tenantId, claim.publicationId, retry ? 'queued' : 'failed', code])
        if (!retry) await sql.query(`UPDATE knowledge_index_sets SET state='failed'
          WHERE tenant_id=$1 AND publication_id=$2 AND state='building'`,
        [claim.tenantId, claim.publicationId])
      })
    }
  }

  private async supersede(sql: Sql, claim: Claim) {
    await sql.query(`UPDATE knowledge_publications SET state='superseded',error_code='publication_changed',updated_at=now()
      WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.publicationId])
    await sql.query(`UPDATE knowledge_index_jobs SET state='cancelled',lease_until=NULL,error_code='publication_changed',updated_at=now()
      WHERE tenant_id=$1 AND id=$2`, [claim.tenantId, claim.jobId])
  }

  async tick(): Promise<boolean> {
    const claim = await this.claim()
    if (!claim) return false
    await this.execute(claim)
    return true
  }
}
