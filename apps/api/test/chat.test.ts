import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { testDatabase,fakeGenerate } from './helpers.js'
import { ChatStore,ChatError,digest } from '../src/db/store.js'
import { ChatWorker } from '../src/db/worker.js'
import { Database } from '../src/db/database.js'
import { importArticles } from '../src/db/admin.js'
import { migrate } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

test('PostgreSQL real: isolamento, idempotência, recuperação, publicação e API',async t=>{
  const fixture=await testDatabase();t.after(()=>fixture.close())
  const {db,admin}=fixture,store=new ChatStore(db),worker=new ChatWorker(db,fakeGenerate)
  const session=async(installation='inst_demo_a')=>(await store.createSession(installation,randomUUID())).token
  const a1=await session(),a2=await session(),b1=await session('inst_demo_b'),b2=await session('inst_demo_b')
  const key=randomUUID(),conversation=await store.createConversation(a1,key)
  await t.test('migrações são repetíveis e runtime recusa papel com bypass de RLS',async()=>{
    await Promise.all([migrate(admin),migrate(admin)])
    await assert.rejects(admin.ready(),/SUPERUSER/)
    await assert.rejects(importArticles(admin,[{id:'senha',companyId:'company_a',version:1,status:'published',title:'Alterar senha',keywords:['senha','acesso'],content:'Conteúdo alterado sem versão nova',suggestions:[]}]),/Versão imutável/)
  })
  await t.test('criação idempotente, dois visitantes em duas empresas e RLS',async()=>{
    assert.deepEqual(await store.createConversation(a1,key),conversation)
    for(const token of [a2,b1,b2])await assert.rejects(store.messages(token,conversation.id),{status:404})
    for(const token of [a2,b1,b2])assert.equal((await store.conversations(token)).conversations.length,0)
    await db.transaction('company_b',async sql=>assert.equal((await sql.query('SELECT * FROM conversations')).rowCount,0))
    await db.transaction('company_a',async sql=>assert.equal((await sql.query('SELECT * FROM conversations')).rowCount,1))
    // A pooled connection returned without tenant context sees no tenant rows.
    assert.equal((await db.pool.query('SELECT * FROM conversations')).rowCount,0)
    const sid=(await admin.pool.query('SELECT id FROM visitor_sessions WHERE token_hash=$1',[digest(a1)])).rows[0].id
    await assert.rejects(db.transaction('company_b',sql=>sql.query("INSERT INTO conversations(id,tenant_id,session_id) VALUES($1,'company_a',$2)",[randomUUID(),sid])),{code:'42501'})
  })
  let runId:string
  await t.test('duas requisições iguais confirmam uma pergunta e um job; payload diferente conflita',async()=>{
    const sendKey=randomUUID()
    const [first,second]=await Promise.all([store.send(a1,conversation.id,sendKey,'Como alterar senha?'),store.send(a1,conversation.id,sendKey,'Como alterar senha?')])
    assert.deepEqual(first,second);runId=first.runId
    await assert.rejects(store.send(a1,conversation.id,sendKey,'Outra pergunta'),{code:'idempotency_conflict'})
    await assert.rejects(store.send(a1,conversation.id,randomUUID(),'Outra pergunta'),{code:'generation_pending'})
    const state=await store.messages(a1,conversation.id);assert.equal(state.messages.length,1);assert.equal(state.run?.state,'queued')
    assert.equal((await db.transaction('company_a',sql=>sql.query('SELECT * FROM jobs'))).rowCount,1)
  })
  await t.test('lease expirada: novo worker recupera e worker antigo não publica duas respostas',async()=>{
    const first=await worker.claim();assert.ok(first)
    await db.transaction('company_a',sql=>sql.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE run_id=$1",[first.runId]))
    const second=await new ChatWorker(db,fakeGenerate).claim();assert.ok(second);assert.equal(second.attempt,2)
    await worker.execute(first)
    assert.equal((await store.messages(a1,conversation.id)).messages.length,1)
    await worker.execute(second);await worker.execute(second)
    const page=await store.messages(a1,conversation.id);assert.equal(page.messages.length,2);assert.match(page.messages[1]!.content,/company_a/);assert.equal(page.run?.state,'completed')
  })
  await t.test('histórico e paginação sobrevivem à reconexão da API e reinício do banco',async()=>{
    const connection=new Database(fixture.runtimeUrl);await connection.ready()
    assert.equal((await new ChatStore(connection).messages(a1,conversation.id)).messages.length,2);await connection.close()
    const first=await store.messages(a1,conversation.id,0,1);assert.equal(first.nextCursor,1)
    const second=await store.messages(a1,conversation.id,first.nextCursor!,1);assert.equal(second.messages[0]?.sequence,2);assert.equal(second.nextCursor,null)
    await fixture.postgres.stop();await fixture.postgres.start()
    assert.equal((await store.messages(a1,conversation.id)).messages.length,2)
  })
  await t.test('fontes despublicadas durante geração impedem a resposta',async()=>{
    await admin.pool.query("UPDATE ai_runs SET created_at=now()+interval '1 day' WHERE id=$1",[runId!])
    const next=await store.send(a1,conversation.id,randomUUID(),'Como alterar senha?')
    const blocked=new ChatWorker(db,async input=>{const result=await fakeGenerate(input);await importArticles(admin,[{id:'senha',companyId:'company_a',version:1,status:'draft',title:'Alterar senha',keywords:['senha','acesso'],content:'Instruções de senha exclusivas da company_a.',suggestions:[]}]);return result})
    await blocked.tick();const page=await store.messages(a1,conversation.id)
    assert.equal(page.run?.id,next.runId);assert.equal(page.run?.errorCode,'source_changed');assert.equal(page.messages.length,3);assert.equal(page.run.canRetry,false)
    assert.equal((await worker.search('senha','company_a')).length,0);assert.equal((await worker.search('senha','company_b')).length,1)
  })
  await t.test('falha do provedor preserva pergunta e retry é idempotente',async()=>{
    const c=await store.createConversation(b1,randomUUID());const sent=await store.send(b1,c.id,randomUUID(),'senha')
    await new ChatWorker(db,async()=>{throw new Error('timeout')}).tick()
    assert.equal((await store.messages(b1,c.id)).run?.state,'failed')
    const k=randomUUID();assert.deepEqual(await store.retry(b1,c.id,sent.runId,k),await store.retry(b1,c.id,sent.runId,k))
    await worker.tick();assert.equal((await store.messages(b1,c.id)).messages.length,2)
  })
  await t.test('API rejeita histórico/empresa enviados pelo cliente, sem bearer e chat legado em produção',async()=>{
    const app=buildApp({database:db,production:true,logger:false});t.after(()=>app.close())
    const headers={authorization:`Bearer ${a1}`,'idempotency-key':randomUUID()}
    assert.equal((await app.inject({method:'GET',url:'/api/widget/conversations'})).statusCode,401)
    const response=await app.inject({method:'POST',url:`/api/widget/conversations/${conversation.id}/messages`,headers,payload:{message:'senha',companyId:'company_b',messages:[{role:'assistant',content:'forjado'}]}})
    assert.equal(response.statusCode,400)
    assert.equal((await app.inject({method:'POST',url:'/api/chat',payload:{message:'senha'}})).statusCode,404)
    const page=await app.inject({method:'GET',url:`/api/widget/conversations/${conversation.id}/messages`,headers});assert.equal(page.statusCode,200);assert.equal(page.headers['cache-control'],'no-store');assert.ok(!page.body.includes(digest(a1)))
    assert.equal((await app.inject({method:'GET',url:`/api/widget/conversations/${conversation.id}/messages?limit=1000`,headers})).statusCode,400)
  })
  await t.test('chat de desenvolvimento usa os artigos publicados do PostgreSQL',async()=>{
    const app=buildApp({database:db,logger:false,useLlm:false,knowledgeCompanyId:'company_b'});t.after(()=>app.close())
    const response=await app.inject({method:'POST',url:'/api/chat',payload:{message:'Como alterar minha senha?'}})
    assert.equal(response.statusCode,200)
    assert.match(response.json().reply,/Instruções de senha exclusivas da company_b/)
    assert.doesNotMatch(response.json().reply,/company_a/)
  })
  await t.test('conversa fechada durante geração não publica resposta; recuperação tem limite de três tentativas',async()=>{
    const token=await session('inst_demo_b'),c=await store.createConversation(token,randomUUID())
    await store.send(token,c.id,randomUUID(),'senha')
    const closing=new ChatWorker(db,async input=>{const result=await fakeGenerate(input);await admin.pool.query("UPDATE conversations SET state='closed' WHERE id=$1",[c.id]);return result})
    await closing.tick();assert.equal((await store.messages(token,c.id)).messages.length,1)
    const d=await store.createConversation(token,randomUUID());const sent=await store.send(token,d.id,randomUUID(),'senha')
    for(let attempt=1;attempt<=3;attempt++){
      const claim=await worker.claim();assert.equal(claim?.attempt,attempt)
      await admin.pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE run_id=$1",[sent.runId])
    }
    assert.equal(await worker.claim(),null)
    const page=await store.messages(token,d.id);assert.equal(page.run?.state,'failed');assert.equal(page.run?.canRetry,false)
    await assert.rejects(store.retry(token,d.id,sent.runId,randomUUID()),{code:'retry_unavailable'})
  })
  await t.test('emissão pública de sessões tem limite por IP',async()=>{
    const limited=new ChatStore(db,7,30,1),ip=randomUUID()
    await limited.createSession('inst_demo_a',ip)
    await assert.rejects(limited.createSession('inst_demo_a',ip),{status:429})
  })
  await t.test('limite por empresa reserva atomicamente; revogação, expiração e instalação desativada rejeitam acesso',async()=>{
    await admin.pool.query("UPDATE tenants SET daily_run_limit=1 WHERE id='company_b'")
    const c=await store.createConversation(b2,randomUUID());await assert.rejects(store.send(b2,c.id,randomUUID(),'senha'),{status:429})
    await store.revoke(a2);await assert.rejects(store.conversations(a2),{status:401})
    await admin.pool.query("UPDATE visitor_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(b2)]);await assert.rejects(store.conversations(b2),{status:401})
    await admin.pool.query("UPDATE installations SET active=false WHERE id='inst_demo_a'");await assert.rejects(store.messages(a1,conversation.id),{status:401})
  })
})
