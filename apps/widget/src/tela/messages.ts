import type { AiRun, ChatMessage, Conversation } from '@support-hub/contracts'
import { ChatClient, RequestError } from '../chat-client'

export function renderMessages(region:HTMLElement,client?:ChatClient):()=>void {
  if(!client){
    region.innerHTML='<p class="overline">SUAS CONVERSAS</p><h1>Mensagens</h1><div class="empty"><h2>Nenhuma conversa por aqui</h2><p>O chat ainda não está disponível nesta instalação.</p></div>'
    return ()=>{}
  }
  const api=client
  region.innerHTML=`<div class="chat-heading"><h1>Mensagens</h1><button id="new-chat" type="button">Nova conversa</button></div>
    <p id="storage-note" class="note" hidden>O navegador não permite guardar sua sessão. Seu histórico ficará disponível apenas enquanto esta página estiver aberta.</p>
    <div id="conversations" aria-label="Suas conversas"></div><button id="more-conversations" type="button" hidden>Mais conversas</button>
    <div id="history" role="log" aria-label="Histórico de mensagens" aria-live="polite"></div><button id="more-messages" type="button" hidden>Carregar próximas mensagens</button>
    <p id="chat-status" role="status"></p><p id="chat-error" role="alert"></p>
    <button id="recover" type="button" hidden>Tentar novamente</button><button id="retry-ai" type="button" hidden>Tentar resposta novamente</button><button id="new-session" type="button" hidden>Iniciar nova sessão</button>
    <form id="composer" hidden><label for="message">Sua mensagem</label><textarea id="message" rows="3" maxlength="500" placeholder="Como podemos ajudar?" required></textarea><div class="composer-actions"><span>Até 500 caracteres · Shift+Enter para nova linha</span><button id="send" type="button">Enviar</button></div></form>
    <button id="end-session" class="text-button" type="button">Encerrar sessão neste navegador</button>`
  const el=<T extends HTMLElement>(id:string)=>region.querySelector<T>(`#${id}`)!
  const status=el('chat-status'),error=el('chat-error'),history=el('history'),list=el('conversations'),form=el<HTMLFormElement>('composer'),input=el<HTMLTextAreaElement>('message'),send=el<HTMLButtonElement>('send'),recover=el<HTMLButtonElement>('recover'),retry=el<HTMLButtonElement>('retry-ai'),newSession=el<HTMLButtonElement>('new-session'),more=el<HTMLButtonElement>('more-conversations'),moreMessages=el<HTMLButtonElement>('more-messages')
  let alive=true,busy=false,loading=false,selected:string|undefined,run:AiRun|null=null,timer:ReturnType<typeof setTimeout>|undefined,listCursor:string|null=null,messageCursor:number|null=null,sequence=0,retryKey=crypto.randomUUID(),failures=0
  const rendered=new Set<string>()
  function controls(){form.hidden=!selected;send.disabled=busy||loading||run?.state==='queued'||run?.state==='running';input.disabled=busy;el('storage-note').hidden=api.persistent;retry.hidden=!run?.canRetry;moreMessages.hidden=messageCursor===null}
  function showError(cause:unknown){
    if(!alive)return
    error.textContent=cause instanceof Error?cause.message:'Não foi possível carregar a conversa.'
    recover.hidden=false
    if(cause instanceof RequestError&&cause.status===401){newSession.hidden=false;recover.hidden=true;form.hidden=true;clearTimeout(timer)}
  }
  function showRun(){
    status.textContent=run?.state==='queued'||run?.state==='running'?'Nora está preparando sua resposta…':run?.state==='failed'?(run.errorCode==='source_changed'?'A base foi atualizada. Envie sua pergunta novamente.':'Não foi possível preparar a resposta. Sua mensagem foi salva.') : ''
    controls()
  }
  function schedule(){clearTimeout(timer);if(alive&&selected)timer=setTimeout(()=>void refresh(),Math.min(1500*2**failures,30000))}
  function append(messages:ChatMessage[]){for(const m of messages){sequence=Math.max(sequence,m.sequence);if(rendered.has(m.id))continue;rendered.add(m.id);const article=document.createElement('article');article.className=`chat-message ${m.role}`;const author=document.createElement('strong');author.textContent=m.role==='user'?'Você':'Nora';const text=document.createElement('p');text.textContent=m.content;article.append(author,text);history.append(article)}}
  async function refresh(){
    const id=selected;if(!id||loading||!alive)return
    loading=true
    try {
      const page=await api.messages(id,sequence)
      if(!alive||selected!==id)return
      append(page.messages);messageCursor=page.nextCursor;run=page.run;failures=0;error.textContent='';recover.hidden=true;showRun()
      if(page.nextCursor!==null||run?.state==='queued'||run?.state==='running')schedule()
    }catch(cause){failures++;showError(cause);if(!(cause instanceof RequestError&&cause.status===401))schedule()}
    finally{loading=false;if(alive)controls()}
  }
  async function select(id:string){
    if(selected)api.drafts.set(selected,input.value)
    selected=id;api.selectedId=id;sequence=0;messageCursor=null;rendered.clear();history.replaceChildren();run=null;input.value=api.pending?.conversationId===id?api.pending.message:api.drafts.get(id)??''
    list.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)))
    status.textContent='Carregando conversa…';controls();await refresh()
    if(api.pending?.conversationId===id){error.textContent='Um envio anterior ainda não foi confirmado. Clique em Enviar para confirmar sem duplicar a mensagem.'}
  }
  function appendConversations(conversations:Conversation[]){for(const c of conversations){const button=document.createElement('button');button.className='conversation';button.dataset.id=c.id;button.type='button';button.textContent=c.title;button.addEventListener('click',()=>{if(!busy&&!loading)void select(c.id)});list.append(button)}}
  async function start(){
    status.textContent='Carregando conversas…';recover.hidden=true;error.textContent=''
    try {
      await api.session();const page=await api.conversations();if(!alive)return
      list.replaceChildren();appendConversations(page.conversations);listCursor=page.nextCursor;more.hidden=!listCursor
      const id=api.selectedId??page.conversations[0]?.id
      if(id)await select(id);else{status.textContent='Nenhuma conversa por aqui';controls()}
    }catch(cause){showError(cause)}
  }
  el('new-chat').addEventListener('click',async()=>{
    if(busy||loading)return
    if(api.pending){showError(new Error('Confirme o envio pendente antes de iniciar outra conversa.'));return}
    busy=true
    try{await api.session();const c=await api.create();if(alive){appendConversations([c]);await select(c.id);input.focus()}}catch(cause){showError(cause)}finally{busy=false;if(alive)controls()}
  })
  async function sendMessage(){
    const message=input.value.trim(),id=selected;if(!id||!message||busy||send.disabled)return
    busy=true;error.textContent='';recover.hidden=true;status.textContent='Confirmando envio…';controls()
    try{await api.send(id,message);if(alive){input.value='';await refresh()}}catch(cause){showError(cause)}finally{busy=false;if(alive){controls();input.focus()}}
  }
  send.addEventListener('click',()=>void sendMessage())
  form.addEventListener('submit',event=>{event.preventDefault();void sendMessage()})
  input.addEventListener('input',()=>{if(selected)api.drafts.set(selected,input.value)})
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!send.disabled)void sendMessage()}})
  retry.addEventListener('click',async()=>{if(!selected||!run||busy)return;busy=true;controls();try{await api.retry(selected,run.id,retryKey);retryKey=crypto.randomUUID();await refresh()}catch(cause){showError(cause)}finally{busy=false;if(alive)controls()}})
  recover.addEventListener('click',()=>void(selected?refresh():start()))
  newSession.addEventListener('click',()=>{api.forgetExpired();selected=undefined;newSession.hidden=true;history.replaceChildren();void start()})
  el('end-session').addEventListener('click',async()=>{if(busy)return;busy=true;try{await api.reset();if(alive){selected=undefined;history.replaceChildren();list.replaceChildren();status.textContent='Sessão encerrada.';form.hidden=true;clearTimeout(timer)}}catch(cause){showError(cause)}finally{busy=false}})
  more.addEventListener('click',async()=>{if(!listCursor)return;try{const page=await api.conversations(listCursor);if(alive){appendConversations(page.conversations);listCursor=page.nextCursor;more.hidden=!listCursor}}catch(cause){showError(cause)}})
  moreMessages.addEventListener('click',()=>void refresh())
  const wake=()=>void(selected?refresh():start())
  window.addEventListener('online',wake);window.addEventListener('supporthub:open',wake)
  void start()
  return()=>{alive=false;clearTimeout(timer);if(selected)api.drafts.set(selected,input.value);window.removeEventListener('online',wake);window.removeEventListener('supporthub:open',wake)}
}
