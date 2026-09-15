import { Chatbot } from './tela/Chatbot'
import { KnowledgePage } from './tela/KnowledgePage'

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  return path === '/chatbot' ? <Chatbot /> : <KnowledgePage />
}
