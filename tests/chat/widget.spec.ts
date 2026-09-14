import { test,expect,type Page } from '@playwright/test'
const widget=(page:Page)=>page.frameLocator('support-hub-root iframe')
async function open(page:Page){await page.goto('/a.html');await page.getByRole('button',{name:'Fale com a gente'}).click();await widget(page).getByRole('button',{name:'Mensagens',exact:true}).click()}
async function create(page:Page){await open(page);await expect(widget(page).getByText('Nenhuma conversa por aqui')).toBeVisible();await widget(page).getByRole('button',{name:'Nova conversa',exact:true}).click();await expect(widget(page).getByLabel('Sua mensagem')).toBeVisible()}

test('envia, fecha, recarrega e retoma a resposta persistida sem misturar empresas',async({page},info)=>{
  await create(page);await widget(page).getByLabel('Sua mensagem').fill('Como alterar senha?');await widget(page).getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(widget(page).getByText('Como alterar senha?',{exact:true}).last()).toBeVisible()
  await page.keyboard.press('Escape');await expect(page.locator('support-hub-root iframe')).toBeHidden()
  await expect(page.getByRole('button',{name:'Fale com a gente'})).toBeFocused()
  await open(page);await expect(widget(page).locator('#history')).toContainText('Instruções de senha exclusivas da company_a.')
  await expect(widget(page).locator('.chat-message.user')).toHaveCount(1);await expect(widget(page).locator('.chat-message.assistant')).toHaveCount(1)
  await page.screenshot({path:info.outputPath('chat.png'),caret:'initial'})
  await page.goto('/b.html');await page.getByRole('button',{name:'Fale com a gente'}).click();await widget(page).getByRole('button',{name:'Mensagens',exact:true}).click();await expect(widget(page).getByText('Nenhuma conversa por aqui')).toBeVisible();await expect(widget(page).locator('#history')).not.toContainText('company_a')
})

test('queda após commit recupera o mesmo envio sem duplicar; texto malicioso é inerte',async({page})=>{
  await create(page);let first=true
  await page.route('**/api/widget/conversations/*/messages',async route=>{
    if(route.request().method()==='POST'&&first){first=false;await route.fetch();await route.abort();return}await route.continue()
  })
  const message='<img src=x onerror="window.compromised=true"> senha'
  await widget(page).getByLabel('Sua mensagem').fill(message);await widget(page).getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(widget(page).locator('#chat-error')).not.toBeEmpty();await expect(widget(page).getByLabel('Sua mensagem')).toHaveValue(message)
  await widget(page).getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(widget(page).locator('.chat-message.assistant')).toHaveCount(1);await expect(widget(page).locator('.chat-message.user')).toHaveCount(1)
  await expect(widget(page).locator('#history img')).toHaveCount(0)
})

test('armazenamento bloqueado avisa sobre retomada e mantém a sessão em memória',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})})
  await create(page);await expect(widget(page).locator('#storage-note')).toBeVisible();await widget(page).getByLabel('Sua mensagem').fill('senha');await widget(page).getByRole('button',{name:'Enviar',exact:true}).click();await expect(widget(page).locator('.chat-message.assistant')).toHaveCount(1)
})

test('falha da IA preserva pergunta, mostra retry e encerrar sessão remove acesso local',async({page})=>{
  await create(page);await widget(page).getByLabel('Sua mensagem').fill('falhar provedor');await widget(page).getByRole('button',{name:'Enviar',exact:true}).click()
  await expect(widget(page).getByText('Não foi possível preparar a resposta. Sua mensagem foi salva.')).toBeVisible();await expect(widget(page).getByRole('button',{name:'Tentar resposta novamente'})).toBeVisible();await expect(widget(page).locator('.chat-message.user')).toHaveCount(1)
  await widget(page).getByRole('button',{name:'Encerrar sessão neste navegador'}).click();await expect(widget(page).getByText('Sessão encerrada.')).toBeVisible()
  await open(page);await expect(widget(page).getByText('Nenhuma conversa por aqui')).toBeVisible()
})
