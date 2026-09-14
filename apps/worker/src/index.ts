import { Database } from '@support-hub/api/database'
import { ChatWorker } from '@support-hub/api/worker'
import { setTimeout } from 'node:timers/promises'
if(!process.env.DATABASE_URL||!process.env.GROQ_API_KEY) throw new Error('Configure DATABASE_URL e GROQ_API_KEY no worker')
const db=new Database(process.env.DATABASE_URL,4)
const worker=new ChatWorker(db)
const stop=new AbortController()
process.on('SIGTERM',()=>stop.abort())
process.on('SIGINT',()=>stop.abort())
await db.ready()
try {
  while(!stop.signal.aborted) {
    try { if(await worker.tick()) continue }
    catch { console.error(JSON.stringify({event:'worker_database_unavailable'})) }
    await setTimeout(1000,undefined,{signal:stop.signal}).catch(()=>{})
  }
} finally {await db.close()}
