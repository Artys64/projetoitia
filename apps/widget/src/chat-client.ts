import type { ApiError, Conversation, ConversationPage, MessagePage, SessionResponse } from '@support-hub/contracts'
export class RequestError extends Error { constructor(readonly status:number,readonly code:string,message:string){super(message)} }
type Pending={conversationId:string;message:string;key:string}
type Saved={token?:string;expiresAt?:string;selectedId?:string;creationKey?:string;pending?:Pending}
export class ChatClient {
  private saved:Saved={}
  readonly drafts=new Map<string,string>()
  persistent=true
  private storageKey:string
  private sessionPromise:Promise<void>|undefined
  constructor(readonly installationId:string, parentOrigin:string) {
    this.storageKey=`supporthub:session:v1:${installationId}:${parentOrigin}`
    try {
      const raw=localStorage.getItem(this.storageKey)
      if(raw) {
        const parsed:unknown=JSON.parse(raw)
        if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) this.saved=parsed as Saved
      }
      localStorage.setItem(this.storageKey,JSON.stringify(this.saved))
    } catch {this.persistent=false;this.saved={}}
  }
  private save() {try {localStorage.setItem(this.storageKey,JSON.stringify(this.saved))}catch{this.persistent=false}}
  get selectedId(){return this.saved.selectedId}
  set selectedId(id:string|undefined){this.saved.selectedId=id;this.save()}
  get pending(){return this.saved.pending}
  async request<T>(path:string,method='GET',body?:unknown,key?:string):Promise<T> {
    let response:Response
    try {
      response=await fetch(`/api/widget${path}`,{method,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{...(this.saved.token?{Authorization:`Bearer ${this.saved.token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})})
    }catch{throw new RequestError(0,'network','Não foi possível confirmar a operação. Verifique sua conexão e tente novamente.')}
    if(!response.ok){const e=await response.json().catch(()=>({})) as Partial<ApiError>;throw new RequestError(response.status,e.code??'unavailable',e.error??'Serviço indisponível. Tente novamente.')}
    return response.json() as Promise<T>
  }
  async session(){
    if(this.saved.token)return
    this.sessionPromise??=(async()=>{const session=await this.request<SessionResponse>('/sessions','POST',{installationId:this.installationId});this.saved={...session};this.save()})().finally(()=>{this.sessionPromise=undefined})
    await this.sessionPromise
  }
  async reset(){if(this.saved.token)await this.request('/session','DELETE');this.saved={};this.drafts.clear();this.save()}
  forgetExpired(){this.saved={};this.drafts.clear();this.save()}
  conversations(before?:string){return this.request<ConversationPage>(`/conversations${before?`?before=${encodeURIComponent(before)}`:''}`)}
  async create(){
    this.saved.creationKey??=crypto.randomUUID();this.save()
    const c=await this.request<Conversation>('/conversations','POST',{},this.saved.creationKey)
    this.saved.creationKey=undefined;this.selectedId=c.id;this.save();return c
  }
  messages(id:string,after=0){return this.request<MessagePage>(`/conversations/${id}/messages?after=${after}`)}
  async send(id:string,message:string){
    if(this.saved.pending&&(this.saved.pending.conversationId!==id||this.saved.pending.message!==message)) throw new RequestError(409,'unconfirmed','Confirme o envio anterior antes de enviar outra mensagem.')
    this.saved.pending??={conversationId:id,message,key:crypto.randomUUID()};this.save()
    try {
      await this.request(`/conversations/${id}/messages`,'POST',{message},this.saved.pending.key)
      this.saved.pending=undefined;this.drafts.delete(id);this.save()
    }catch(error){
      if(error instanceof RequestError&&[400,401,403,404,409,429].includes(error.status)){this.saved.pending=undefined;this.save()}
      throw error
    }
  }
  retry(id:string,runId:string,key:string){return this.request(`/conversations/${id}/ai-runs/${runId}/retry`,'POST',{},key)}
}
