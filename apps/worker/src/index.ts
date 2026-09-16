import { Database } from '@support-hub/api/database'
import { ChatWorker } from '@support-hub/api/worker'
import { KnowledgeIndexer,createEmbeddingProvider } from '@support-hub/api/knowledge'
import { setTimeout } from 'node:timers/promises'
if(!process.env.DATABASE_URL||!process.env.GROQ_API_KEY||!process.env.EMBEDDINGS_URL) throw new Error('Configure DATABASE_URL, GROQ_API_KEY e EMBEDDINGS_URL no worker')
const db=new Database(process.env.DATABASE_URL,4)
const embeddings=createEmbeddingProvider()
const worker=new ChatWorker(db,undefined,embeddings)
const indexer=new KnowledgeIndexer(db,embeddings)
const stop=new AbortController()
process.on('SIGTERM',()=>stop.abort())
process.on('SIGINT',()=>stop.abort())
await db.ready()
try {
  while(!stop.signal.aborted) {
    try {
      if(await indexer.tick()) continue
      if(await worker.tick()) continue
    }
    catch { console.error(JSON.stringify({event:'worker_database_unavailable'})) }
    await setTimeout(1000,undefined,{signal:stop.signal}).catch(()=>{})
  }
} finally {await db.close()}
