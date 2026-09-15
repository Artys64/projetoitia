import type { FastifyInstance, FastifyRequest } from 'fastify'
import { chatSchemas } from '@support-hub/contracts'
import { ChatError, ChatStore } from './db/store.js'
import { AccessError, bearerToken, requireUserAccess } from './middlewares/access.js'
import { installUserAccess } from './middlewares/user-access.js'

export function registerWidgetRoutes(app: FastifyInstance, store: ChatStore) {
  // Encapsulation keeps the legacy development routes independent.
  app.register(async api => {
    api.addHook('onRequest',async(_request,reply)=>{ reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff') })
    api.setErrorHandler((error:Error & {validation?:unknown},request,reply)=>{
      if(error instanceof ChatError) {
        if(error.status===429) reply.header('Retry-After','60')
        return reply.code(error.status).send({code:error.code,error:error.message})
      }
      if(error instanceof AccessError) return reply.code(error.statusCode).send({code:error.code,error:error.message})
      if(error.validation) return reply.code(400).send({code:'invalid_request',error:'Solicitação inválida.'})
      request.log.error({event:'widget_request_failed',requestId:request.id},'Falha no chat')
      return reply.code(503).send({code:'unavailable',error:'Serviço temporariamente indisponível. Tente novamente.'})
    })
    const key=(r:FastifyRequest)=>typeof r.headers['idempotency-key']==='string'?r.headers['idempotency-key']:''
    const idParams={type:'object',required:['id'],additionalProperties:false,properties:{id:chatSchemas.id}}
    api.post<{Body:{installationId:string}}>('/sessions',{schema:{body:chatSchemas.session}},async r=>store.createSession(r.body.installationId,r.ip))
    api.register(async protectedApi => {
      installUserAccess(protectedApi, store)
      protectedApi.get('/session',{schema:{querystring:chatSchemas.empty}},async r=>{
        const {role,companyId,installationId}=requireUserAccess(r)
        return {role,companyId,installationId}
      })
      protectedApi.delete('/session',async r=>store.revoke(bearerToken(r)))
      protectedApi.get<{Querystring:{before?:string;limit?:number}}>('/conversations',{schema:{querystring:chatSchemas.conversationQuery}},async r=>store.conversations(bearerToken(r),r.query.before,r.query.limit))
      protectedApi.post('/conversations',{schema:{body:chatSchemas.empty}},async r=>store.createConversation(bearerToken(r),key(r)))
      protectedApi.get<{Params:{id:string};Querystring:{after?:number;limit?:number}}>('/conversations/:id/messages',{schema:{params:idParams,querystring:chatSchemas.messageQuery}},async r=>store.messages(bearerToken(r),r.params.id,r.query.after,r.query.limit))
      protectedApi.post<{Params:{id:string};Body:{message:string}}>('/conversations/:id/messages',{schema:{params:idParams,body:chatSchemas.message}},async(r,reply)=>{
        const result=await store.send(bearerToken(r),r.params.id,key(r),r.body.message.trim())
        return reply.code(202).send(result)
      })
      protectedApi.post<{Params:{id:string;runId:string}}>('/conversations/:id/ai-runs/:runId/retry',{schema:{params:{...idParams,required:['id','runId'],properties:{id:chatSchemas.id,runId:chatSchemas.id}},body:chatSchemas.empty}},async(r,reply)=>reply.code(202).send(await store.retry(bearerToken(r),r.params.id,r.params.runId,key(r))))
    })
  },{prefix:'/api/widget'})
}
