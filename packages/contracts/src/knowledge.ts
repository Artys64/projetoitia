export type KnowledgeFormat = 'text' | 'markdown'

export type KnowledgeItem = {
  id: string
  title: string
  content: string
  format: KnowledgeFormat
  sourceName: string | null
  draftRevision: number | null
  publishedVersion: number | null
  hasUnpublishedChanges: boolean
  updatedAt: string
  publication: KnowledgePublication | null
}

export type KnowledgePublication = {
  id: string
  state: 'queued' | 'indexing' | 'ready' | 'active' | 'failed' | 'cancelled' | 'superseded'
  progress: number
  errorCode: string | null
}

export type KnowledgeListResponse = { items: KnowledgeItem[] }

export type KnowledgeWrite = {
  title: string
  content: string
  format: KnowledgeFormat
  sourceName?: string | null
}

export type KnowledgeUpdate = KnowledgeWrite & { expectedRevision: number | null }

const writeProperties = {
  title: { type: 'string', minLength: 1, maxLength: 160, pattern: '\\S' },
  content: { type: 'string', minLength: 1, maxLength: 200000, pattern: '\\S' },
  format: { type: 'string', enum: ['text', 'markdown'] },
  sourceName: { anyOf: [{ type: 'string', minLength: 1, maxLength: 255 }, { type: 'null' }] },
} as const

export const knowledgeSchemas = {
  empty: { type: 'object', additionalProperties: false, properties: {} },
  params: {
    type: 'object', additionalProperties: false, required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  create: {
    type: 'object', additionalProperties: false, required: ['title', 'content', 'format'],
    properties: writeProperties,
  },
  update: {
    type: 'object', additionalProperties: false,
    required: ['title', 'content', 'format', 'expectedRevision'],
    properties: {
      ...writeProperties,
      expectedRevision: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    },
  },
  publish: {
    type: 'object', additionalProperties: false, required: ['expectedRevision'],
    properties: { expectedRevision: { type: 'integer', minimum: 1 } },
  },
} as const
