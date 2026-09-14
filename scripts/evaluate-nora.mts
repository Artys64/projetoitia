import { writeFile,mkdir } from 'node:fs/promises'
import { groq } from '@ai-sdk/groq'
import { generateNoraResponse } from '../apps/api/src/ia/agents/nora.js'
import { loadArticles } from '../apps/api/src/ia/knowledge/repository.js'
import { createTextSearch } from '../apps/api/src/ia/knowledge/search.js'
if(!process.env.GROQ_API_KEY) throw new Error('Configure a chave Groq no ambiente; esta avaliação faz chamadas reais')
const search=createTextSearch(loadArticles())
const cases=[{name:'pergunta coberta',message:'Esqueci minha senha. Como recuperar o acesso?'},{name:'fora da base',message:'Vocês vendem seguro para viagens à Antártida?'},{name:'interação social',message:'Obrigado pela ajuda!'}]
const results=[]
for(const item of cases){
  const started=Date.now()
  try{
    const result=await generateNoraResponse({model:groq(process.env.GROQ_MODEL||'openai/gpt-oss-20b'),messages:[{role:'user',content:item.message}],search,companyId:'support-hub'})
    results.push({case:item.name,reply:result.text,model:result.model,searches:result.searches,steps:result.steps,usage:result.usage,sources:result.sources.map(s=>({articleId:s.articleId,version:s.version})),durationMs:Date.now()-started})
  }catch{results.push({case:item.name,error:'generation_failed',durationMs:Date.now()-started});process.exitCode=1}
}
await mkdir('test-results',{recursive:true})
await writeFile('test-results/groq-evaluation.json',JSON.stringify({date:new Date().toISOString(),results},null,2))
console.info(JSON.stringify(results,null,2))
