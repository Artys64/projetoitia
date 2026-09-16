import { randomUUID } from 'node:crypto'
import type {
  KnowledgeFormat,
  KnowledgeItem,
  KnowledgeUpdate,
  KnowledgeWrite,
} from '@support-hub/contracts'
import type { AdminAccess } from '../middlewares/access.js'
import type { AdminSessionStore } from './admin-sessions.js'
import type { Sql } from './database.js'

export class KnowledgeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type KnowledgeRow = {
  id: string
  published_version: number | null
  draft_revision: number | null
  published_revision: number | null
  draft_title: string | null
  draft_content: string | null
  source_format: KnowledgeFormat | null
  source_name: string | null
  published_title: string | null
  published_content: string | null
  updated_at: Date | string | null
  publication_id: string | null
  publication_state: string | null
  publication_error: string | null
  publication_progress: number | null
}

const selectKnowledge = `
  SELECT a.id, a.published_version,
    d.revision AS draft_revision, d.published_revision,
    d.title AS draft_title, d.content AS draft_content,
    d.source_format, d.source_name, d.updated_at,
    v.title AS published_title, v.content AS published_content,
    p.id AS publication_id,p.state AS publication_state,p.error_code AS publication_error,
    CASE WHEN j.state='completed' THEN 100
      WHEN s.expected_chunks>0 THEN LEAST(99,(s.completed_chunks*100/s.expected_chunks))
      WHEN p.state='indexing' THEN 1 ELSE 0 END AS publication_progress
  FROM articles a
  LEFT JOIN article_drafts d
    ON d.tenant_id=a.tenant_id AND d.article_id=a.id
  LEFT JOIN article_versions v
    ON v.tenant_id=a.tenant_id AND v.article_id=a.id AND v.version=a.published_version
  LEFT JOIN LATERAL (
    SELECT * FROM knowledge_publications p0 WHERE p0.tenant_id=a.tenant_id AND p0.article_id=a.id
    ORDER BY p0.created_at DESC LIMIT 1
  ) p ON true
  LEFT JOIN knowledge_index_jobs j ON j.tenant_id=p.tenant_id AND j.publication_id=p.id
  LEFT JOIN knowledge_index_sets s ON s.tenant_id=p.tenant_id AND s.publication_id=p.id
  WHERE a.tenant_id=$1
`

function item(row: KnowledgeRow): KnowledgeItem {
  const updated = row.updated_at ? new Date(row.updated_at) : new Date(0)
  return {
    id: row.id,
    title: row.draft_title ?? row.published_title ?? 'Sem título',
    content: row.draft_content ?? row.published_content ?? '',
    format: row.source_format ?? 'text',
    sourceName: row.source_name,
    draftRevision: row.draft_revision,
    publishedVersion: row.published_version,
    hasUnpublishedChanges: row.draft_revision !== null &&
      (row.published_version === null || row.draft_revision !== row.published_revision),
    updatedAt: updated.toISOString(),
    publication: row.publication_id ? {
      id: row.publication_id,
      state: row.publication_state as NonNullable<KnowledgeItem['publication']>['state'],
      progress: Number(row.publication_progress ?? 0),
      errorCode: row.publication_error,
    } : null,
  }
}

function normalize(write: KnowledgeWrite): KnowledgeWrite {
  return {
    title: write.title.trim(),
    content: write.content.replace(/\r\n?/g, '\n'),
    format: write.format,
    sourceName: write.sourceName?.trim() || null,
  }
}

export class AdminKnowledgeStore {
  constructor(readonly sessions: AdminSessionStore) {}

  async list(access: AdminAccess): Promise<KnowledgeItem[]> {
    return this.sessions.authorized(access, async sql => {
      const rows = (await sql.query(`${selectKnowledge} ORDER BY COALESCE(d.updated_at,'epoch') DESC, a.id`,
        [access.companyId])).rows as KnowledgeRow[]
      return rows.map(item)
    })
  }

  async create(access: AdminAccess, value: KnowledgeWrite): Promise<KnowledgeItem> {
    const draft = normalize(value)
    return this.sessions.authorized(access, async sql => {
      const id = randomUUID()
      await sql.query('INSERT INTO articles(tenant_id,id) VALUES($1,$2)', [access.companyId, id])
      await sql.query(`
        INSERT INTO article_drafts(tenant_id,article_id,title,content,source_format,source_name)
        VALUES($1,$2,$3,$4,$5,$6)
      `, [access.companyId, id, draft.title, draft.content, draft.format, draft.sourceName])
      return this.read(sql, access.companyId, id)
    })
  }

  async update(access: AdminAccess, id: string, value: KnowledgeUpdate): Promise<KnowledgeItem> {
    const draft = normalize(value)
    return this.sessions.authorized(access, async sql => {
      const article = await sql.query('SELECT id FROM articles WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [access.companyId, id])
      if (!article.rowCount) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
      const current = (await sql.query('SELECT revision FROM article_drafts WHERE tenant_id=$1 AND article_id=$2 FOR UPDATE',
        [access.companyId, id])).rows[0] as { revision: number } | undefined
      if ((current?.revision ?? null) !== value.expectedRevision) {
        throw new KnowledgeError(409, 'knowledge_changed', 'Este conteúdo foi alterado em outra sessão. Recarregue antes de salvar.')
      }
      if (current) {
        await sql.query(`
          UPDATE article_drafts SET revision=revision+1,title=$3,content=$4,source_format=$5,
            source_name=$6,updated_at=now() WHERE tenant_id=$1 AND article_id=$2
        `, [access.companyId, id, draft.title, draft.content, draft.format, draft.sourceName])
      } else {
        await sql.query(`
          INSERT INTO article_drafts(tenant_id,article_id,title,content,source_format,source_name)
          VALUES($1,$2,$3,$4,$5,$6)
        `, [access.companyId, id, draft.title, draft.content, draft.format, draft.sourceName])
      }
      return this.read(sql, access.companyId, id)
    })
  }

  async publish(access: AdminAccess, id: string, expectedRevision: number): Promise<KnowledgeItem> {
    return this.sessions.authorized(access, async sql => {
      const article = await sql.query('SELECT id FROM articles WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [access.companyId, id])
      if (!article.rowCount) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
      const draft = (await sql.query(`
        SELECT revision,title,content FROM article_drafts
        WHERE tenant_id=$1 AND article_id=$2 FOR UPDATE
      `, [access.companyId, id])).rows[0] as { revision: number; title: string; content: string } | undefined
      if (!draft) throw new KnowledgeError(409, 'draft_required', 'Salve um rascunho antes de publicar.')
      if (draft.revision !== expectedRevision) {
        throw new KnowledgeError(409, 'knowledge_changed', 'O rascunho mudou antes da publicação. Recarregue e tente novamente.')
      }
      const pending = (await sql.query(`SELECT id FROM knowledge_publications
        WHERE tenant_id=$1 AND article_id=$2 AND draft_revision=$3
          AND state IN ('queued','indexing','ready') ORDER BY created_at DESC LIMIT 1`,
      [access.companyId, id, expectedRevision])).rows[0]
      if (pending) return this.read(sql, access.companyId, id)
      await sql.query(`UPDATE knowledge_publications SET state='superseded',error_code='newer_publication',updated_at=now()
        WHERE tenant_id=$1 AND article_id=$2 AND state IN ('queued','indexing','ready')`, [access.companyId, id])
      await sql.query(`UPDATE knowledge_index_jobs SET state='cancelled',error_code='newer_publication',lease_until=NULL,updated_at=now()
        WHERE tenant_id=$1 AND publication_id IN (
          SELECT id FROM knowledge_publications WHERE tenant_id=$1 AND article_id=$2 AND state='superseded'
        ) AND state IN ('queued','running')`, [access.companyId, id])
      const version = Number((await sql.query(`
        SELECT COALESCE(MAX(version),0)+1 AS version FROM article_versions
        WHERE tenant_id=$1 AND article_id=$2
      `, [access.companyId, id])).rows[0].version)
      await sql.query(`
        INSERT INTO article_versions(tenant_id,article_id,version,title,content,keywords,suggestions)
        VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb)
      `, [access.companyId, id, version, draft.title, draft.content])
      const publicationId = randomUUID()
      await sql.query(`INSERT INTO knowledge_publications(tenant_id,id,article_id,article_version,
        draft_revision,previous_published_version,requested_by)
        SELECT $1,$2,$3,$4,$5,published_version,$6 FROM articles WHERE tenant_id=$1 AND id=$3`,
      [access.companyId, publicationId, id, version, expectedRevision, access.userId])
      await sql.query(`INSERT INTO knowledge_index_jobs(tenant_id,id,publication_id)
        VALUES($1,$2,$3)`, [access.companyId, randomUUID(), publicationId])
      return this.read(sql, access.companyId, id)
    })
  }

  async unpublish(access: AdminAccess, id: string): Promise<KnowledgeItem> {
    return this.sessions.authorized(access, async sql => {
      const current = (await sql.query(`SELECT active_index_set_id FROM articles
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [access.companyId, id])).rows[0]
      if (!current) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
      await sql.query(`UPDATE knowledge_publications SET state='cancelled',error_code='unpublished',updated_at=now()
        WHERE tenant_id=$1 AND article_id=$2 AND state IN ('queued','indexing','ready')`, [access.companyId, id])
      await sql.query(`UPDATE knowledge_index_jobs SET state='cancelled',error_code='unpublished',lease_until=NULL,updated_at=now()
        WHERE tenant_id=$1 AND publication_id IN (
          SELECT id FROM knowledge_publications WHERE tenant_id=$1 AND article_id=$2 AND state='cancelled'
        ) AND state IN ('queued','running')`, [access.companyId, id])
      const changed = await sql.query(`
        UPDATE articles SET published_version=NULL,active_index_set_id=NULL
        WHERE tenant_id=$1 AND id=$2 RETURNING id
      `, [access.companyId, id])
      if (!changed.rowCount) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
      if (current.active_index_set_id) await sql.query(`UPDATE knowledge_index_sets SET state='retired'
        WHERE tenant_id=$1 AND id=$2`, [access.companyId, current.active_index_set_id])
      await sql.query(`UPDATE knowledge_retrieval_configs SET generation=generation+1,updated_at=now()
        WHERE tenant_id=$1`, [access.companyId])
      return this.read(sql, access.companyId, id)
    })
  }

  async delete(access: AdminAccess, id: string): Promise<void> {
    await this.sessions.authorized(access, async sql => {
      const article = await sql.query(`
        SELECT id FROM articles WHERE tenant_id=$1 AND id=$2 FOR UPDATE
      `, [access.companyId, id])
      if (!article.rowCount) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')

      // The published-version reference points back to article_versions, so detach it
      // before deleting the article and all of its editorial history.
      await sql.query('UPDATE articles SET published_version=NULL,active_index_set_id=NULL WHERE tenant_id=$1 AND id=$2',
        [access.companyId, id])
      await sql.query(`DELETE FROM knowledge_index_jobs WHERE tenant_id=$1 AND publication_id IN
        (SELECT id FROM knowledge_publications WHERE tenant_id=$1 AND article_id=$2)`, [access.companyId, id])
      await sql.query('DELETE FROM knowledge_index_sets WHERE tenant_id=$1 AND article_id=$2', [access.companyId, id])
      await sql.query('DELETE FROM knowledge_publications WHERE tenant_id=$1 AND article_id=$2', [access.companyId, id])
      await sql.query('DELETE FROM article_drafts WHERE tenant_id=$1 AND article_id=$2',
        [access.companyId, id])
      await sql.query('DELETE FROM article_versions WHERE tenant_id=$1 AND article_id=$2',
        [access.companyId, id])
      await sql.query('DELETE FROM articles WHERE tenant_id=$1 AND id=$2',
        [access.companyId, id])
    })
  }

  private async read(sql: Sql, companyId: string, id: string): Promise<KnowledgeItem> {
    const row = (await sql.query(`${selectKnowledge} AND a.id=$2`, [companyId, id])).rows[0] as KnowledgeRow | undefined
    if (!row) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
    return item(row)
  }
}
