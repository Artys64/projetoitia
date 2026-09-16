import { KnowledgeIndexer } from './knowledge-indexer.js'
import { Database } from './database.js'
import { createEmbeddingProvider } from '../ia/embeddings/local.js'

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL')
const db = new Database(process.env.DATABASE_URL, 2)
const indexer = new KnowledgeIndexer(db, createEmbeddingProvider())
let processed = 0
try {
  await db.ready()
  while (await indexer.tick()) processed++
  console.info(JSON.stringify({ event: 'knowledge_index_completed', processed }))
} finally { await db.close() }
