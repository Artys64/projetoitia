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
}

const selectKnowledge = `
  SELECT a.id, a.published_version,
    d.revision AS draft_revision, d.published_revision,
    d.title AS draft_title, d.content AS draft_content,
    d.source_format, d.source_name, d.updated_at,
    v.title AS published_title, v.content AS published_content
  FROM articles a
  LEFT JOIN article_drafts d
    ON d.tenant_id=a.tenant_id AND d.article_id=a.id
  LEFT JOIN article_versions v
    ON v.tenant_id=a.tenant_id AND v.article_id=a.id AND v.version=a.published_version
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
      const version = Number((await sql.query(`
        SELECT COALESCE(MAX(version),0)+1 AS version FROM article_versions
        WHERE tenant_id=$1 AND article_id=$2
      `, [access.companyId, id])).rows[0].version)
      await sql.query(`
        INSERT INTO article_versions(tenant_id,article_id,version,title,content,keywords,suggestions)
        VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb)
      `, [access.companyId, id, version, draft.title, draft.content])
      await sql.query('UPDATE articles SET published_version=$3 WHERE tenant_id=$1 AND id=$2',
        [access.companyId, id, version])
      await sql.query(`
        UPDATE article_drafts SET published_revision=revision,updated_at=now()
        WHERE tenant_id=$1 AND article_id=$2
      `, [access.companyId, id])
      return this.read(sql, access.companyId, id)
    })
  }

  async unpublish(access: AdminAccess, id: string): Promise<KnowledgeItem> {
    return this.sessions.authorized(access, async sql => {
      const changed = await sql.query(`
        UPDATE articles SET published_version=NULL
        WHERE tenant_id=$1 AND id=$2 RETURNING id
      `, [access.companyId, id])
      if (!changed.rowCount) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
      return this.read(sql, access.companyId, id)
    })
  }

  private async read(sql: Sql, companyId: string, id: string): Promise<KnowledgeItem> {
    const row = (await sql.query(`${selectKnowledge} AND a.id=$2`, [companyId, id])).rows[0] as KnowledgeRow | undefined
    if (!row) throw new KnowledgeError(404, 'knowledge_not_found', 'Conteúdo não encontrado.')
    return item(row)
  }
}
