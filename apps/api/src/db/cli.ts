import { readFile } from 'node:fs/promises'
import { Database } from './database.js'
import { migrate } from './migrate.js'
import { importArticles,importInstallation,issueAdminSession,provisionRuntime,queueKnowledgeBackfill } from './admin.js'
import { readTenantMetrics } from './metrics.js'
const [command,path]=process.argv.slice(2)
const url=process.env.MIGRATION_DATABASE_URL
if(!url) throw new Error('Configure MIGRATION_DATABASE_URL para operações administrativas')
const db=new Database(url)
try {
  switch(command) {
    case 'migrate': await migrate(db);break
    case 'provision': await provisionRuntime(db,process.env.APP_DATABASE_PASSWORD??'');break
    case 'installation': if(!path) throw new Error('Informe o arquivo JSON'); await importInstallation(db,JSON.parse(await readFile(path,'utf8')),process.env.NODE_ENV==='production');break
    case 'articles': if(!path) throw new Error('Informe o arquivo JSON'); await importArticles(db,JSON.parse(await readFile(path,'utf8')));break
    case 'admin-session': {
      if(!path) throw new Error('Informe o ID da empresa')
      console.info(JSON.stringify(await issueAdminSession(db,path)))
      break
    }
    case 'metrics': {
      const tenants=(await db.pool.query('SELECT id FROM tenants')).rows
      for(const t of tenants) console.info(JSON.stringify(await db.transaction(t.id,async sql=>{
        return {tenantId:t.id,...await readTenantMetrics(sql,t.id)}
      })))
      break
    }
    case 'prune-rate-buckets': await db.pool.query('DELETE FROM session_rate_buckets WHERE expires_at<now()');break
    case 'knowledge-backfill': console.info(JSON.stringify({queued:await queueKnowledgeBackfill(db)}));break
    default: throw new Error('Use: db migrate|provision|installation arquivo.json|articles arquivo.json|admin-session empresa|metrics|knowledge-backfill|prune-rate-buckets')
  }
  console.info(JSON.stringify({event:'database_command_completed',command}))
} catch {console.error(JSON.stringify({event:'database_command_failed',command}));process.exitCode=1}
finally {await db.close()}
