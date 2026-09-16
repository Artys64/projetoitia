import { localPostgres } from './postgres.js'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Database } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { provisionRuntime,importInstallation,importArticles } from '../src/db/admin.js'
import { demoInstallations } from '../src/embed.js'
import { fixtureGenerate } from './simulated-nora.js'
import { DeterministicEmbeddingProvider } from '../src/ia/embeddings/provider.js'
import { KnowledgeIndexer } from '../src/db/knowledge-indexer.js'

export async function testDatabase() {
  const server=createServer()
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=(server.address() as {port:number}).port
  await new Promise<void>(resolve=>server.close(()=>resolve()))
  const directory=await mkdtemp(join(tmpdir(),'support-hub-pg-'))
  const postgres=await localPostgres(directory,port)
  const adminUrl=`postgresql://postgres:local_admin_password@127.0.0.1:${port}/postgres`
  const runtimeUrl=`postgresql://support_hub_app:local_runtime_password_123@127.0.0.1:${port}/postgres`
  const admin=new Database(adminUrl)
  await migrate(admin);await provisionRuntime(admin,'local_runtime_password_123')
  const db=new Database(runtimeUrl,2)
  await db.ready()
  const embeddings=new DeterministicEmbeddingProvider()
  for(const installation of demoInstallations)await importInstallation(admin,installation,false)
  for(const tenant of ['company_a','company_b'])await importArticles(admin,[{id:'senha',companyId:tenant,version:1,status:'published',title:'Alterar senha',keywords:['senha','acesso'],content:`Instruções de senha exclusivas da ${tenant}.`,suggestions:[]}])
  const indexer=new KnowledgeIndexer(db,embeddings)
  while(await indexer.tick()) {}
  return {admin,db,postgres,runtimeUrl,embeddings,indexer,async close(){
    await db.close();await admin.close();await postgres.destroy();await rm(directory,{recursive:true,force:true})
  }}
}
export const fakeGenerate=fixtureGenerate()
