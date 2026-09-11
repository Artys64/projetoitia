const events = document.getElementById('events')
function log(message) { events.textContent = message }
window.addEventListener('supporthub:error', event => log(`Erro: ${event.detail.code}`))
let count = 0
document.getElementById('counter').addEventListener('click', event => { event.currentTarget.textContent = `Contador: ${++count}` })
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault()
  document.getElementById('form-result').textContent = `Recebido nesta página: ${new FormData(event.currentTarget).get('name')}`
})
const loader = document.querySelector('script[data-installation-id]')
loader?.addEventListener('error', () => log('Erro: download do loader'))
loader?.addEventListener('load', () => {
  for (const event of ['ready', 'opened', 'closed', 'error']) window.SupportHub?.on(event, payload => log(`Widget: ${event}${payload.code ? ` (${payload.code})` : ''}`))
})
document.getElementById('open').addEventListener('click', () => {
  if (window.SupportHub) window.SupportHub.open()
  else log('O loader ainda não está disponível nesta página.')
})
