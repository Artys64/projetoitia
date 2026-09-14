import { localPostgres } from './postgres.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Database } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { provisionRuntime,importInstallation,importArticles } from '../src/db/admin.js'
import { demoInstallations } from '../src/embed.js'
import type { Generate } from '../src/db/worker.js'

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
  for(const installation of demoInstallations)await importInstallation(admin,installation,false)
  for(const tenant of ['company_a','company_b'])await importArticles(admin,[{id:'senha',companyId:tenant,version:1,status:'published',title:'Alterar senha',keywords:['senha','acesso'],content:`Instruções de senha exclusivas da ${tenant}.`,suggestions:[]}])
  return {admin,db,postgres,runtimeUrl,async close(){await db.close();await admin.close();await postgres.stop()}}
}
export const fakeGenerate:Generate=async({messages,search,companyId})=>{
  const sources=await search(messages.at(-1)?.content??'',companyId)
  return {text:sources[0]?.text??'Não encontrei orientação na base.',sources,searches:1,steps:2,model:'test-provider',usage:{inputTokens:10,outputTokens:5,totalTokens:15} as never}
}
