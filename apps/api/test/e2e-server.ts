import { testDatabase,fakeGenerate } from './helpers.js'
import { buildApp } from '../src/app.js'
import { ChatWorker } from '../src/db/worker.js'
const fixture=await testDatabase()
const app=buildApp({database:fixture.db,logger:false,sessionIssuanceLimit:200})
const worker=new ChatWorker(fixture.db,async input=>{
  await new Promise(resolve=>setTimeout(resolve,500))
  if(input.messages.at(-1)?.content==='falhar provedor')throw new Error('simulated')
  return fakeGenerate(input)
})
let stopping=false
await app.listen({host:'127.0.0.1',port:3000})
console.log('Chat E2E pronto, banco real e provedor simulado')
async function shutdown(){stopping=true;await app.close()}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown())
try{while(!stopping){if(!await worker.tick())await new Promise(resolve=>setTimeout(resolve,100))}}finally{await fixture.close()}
