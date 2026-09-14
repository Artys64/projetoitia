import { Chatbot } from './tela/Chatbot'
import { HostPage } from './tela/HostPage'

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  return path === '/chatbot' ? <Chatbot /> : <HostPage />
}
