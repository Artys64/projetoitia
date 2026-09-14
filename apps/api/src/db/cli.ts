import { readFile } from 'node:fs/promises'
import { Database } from './database.js'
import { migrate } from './migrate.js'
import { importArticles,importInstallation,provisionRuntime } from './admin.js'
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
    case 'metrics': {
      const tenants=(await db.pool.query('SELECT id FROM tenants')).rows
      for(const t of tenants) console.info(JSON.stringify(await db.transaction(t.id,async sql=>{
        const counts=(await sql.query(`SELECT state,count(*)::int AS count,avg(duration_ms)::int AS average_ms,sum(COALESCE((usage->>'totalTokens')::bigint,0))::text AS tokens FROM ai_runs WHERE created_at>now()-interval '1 day' GROUP BY state`)).rows
        const queue=(await sql.query("SELECT count(*)::int AS pending,extract(epoch FROM now()-min(available_at))::int AS oldest_seconds FROM jobs")).rows[0]
        const reservations=(await sql.query("SELECT actor,reserved_runs FROM usage_buckets WHERE day=CURRENT_DATE AND actor='tenant'")).rows
        return {tenantId:t.id,counts,queue,reservations}
      })))
      break
    }
    case 'prune-rate-buckets': await db.pool.query('DELETE FROM session_rate_buckets WHERE expires_at<now()');break
    default: throw new Error('Use: db migrate|provision|installation arquivo.json|articles arquivo.json|metrics|prune-rate-buckets')
  }
  console.info(JSON.stringify({event:'database_command_completed',command}))
} catch {console.error(JSON.stringify({event:'database_command_failed',command}));process.exitCode=1}
finally {await db.close()}
