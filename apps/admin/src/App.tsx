import { FormEvent, useEffect, useRef, useState } from 'react'

type HealthResponse = {
  status: 'ok'
  service: string
  timestamp: string
}

type ChatResponse = {
  reply: string
  suggestions: string[]
}

type Message = {
  id: string
  author: 'assistant' | 'user'
  text: string
  time: string
  suggestions?: string[]
  failed?: boolean
}

const initialMessages: Message[] = [
  {
    id: 'welcome',
    author: 'assistant',
    text: 'Oi! Eu sou a Nora, assistente virtual da Support Hub. Como posso ajudar você hoje?',
    time: currentTime(),
    suggestions: ['Esqueci minha senha', 'Conhecer os planos', 'Falar com uma pessoa'],
  },
]

function currentTime() {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

function createMessage(
  author: Message['author'],
  text: string,
  options: Pick<Message, 'suggestions' | 'failed'> = {},
): Message {
  return {
    id: `${author}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author,
    text,
    time: currentTime(),
    ...options,
  }
}

function Chatbot() {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine)

    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)

    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  async function submitMessage(text: string) {
    const normalizedText = text.trim()
    if (!normalizedText || isSending || !isOnline) return

    const userMessage = createMessage('user', normalizedText)
    const conversation = [
      ...messages.map((message) => ({ ...message, suggestions: undefined })),
      userMessage,
    ]

    setMessages(conversation)
    setDraft('')
    setIsSending(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: conversation
            .filter((message) => !message.failed)
            .slice(-12)
            .map((message) => ({
              role: message.author,
              content: message.text,
            })),
        }),
      })

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(result?.error ?? 'Não foi possível enviar a mensagem')
      }

      const result = (await response.json()) as ChatResponse
      setMessages((current) => [
        ...current,
        createMessage('assistant', result.reply, {
          suggestions: result.suggestions,
        }),
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        createMessage(
          'assistant',
          error instanceof Error
            ? error.message
            : 'Não consegui responder agora. Tente novamente em alguns instantes.',
          { failed: true, suggestions: ['Tentar novamente'] },
        ),
      ])
    } finally {
      setIsSending(false)
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitMessage(draft)
  }

  function useSuggestion(suggestion: string) {
    if (suggestion === 'Tentar novamente') {
      const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.author === 'user')

      if (lastUserMessage) void submitMessage(lastUserMessage.text)
      return
    }

    void submitMessage(suggestion)
  }

  return (
    <main className="chatbot-page">
      <section className="chatbot" aria-label="Chat de suporte">
        <header className="chatbot-header">
          <div className="chatbot-identity">
            <span className="chatbot-avatar" aria-hidden="true">N</span>
            <div>
              <h1>Nora</h1>
              <p>
                <span className={`presence-dot ${isOnline ? '' : 'offline'}`} />
                {isOnline ? 'Assistente virtual • online' : 'Sem conexão'}
              </p>
            </div>
          </div>
        </header>

        <div className="messages" aria-live="polite" aria-busy={isSending}>
          <p className="conversation-date">Hoje</p>

          {messages.map((message) => (
            <article className={`message-row ${message.author}`} key={message.id}>
              {message.author === 'assistant' && (
                <span className="message-avatar" aria-hidden="true">N</span>
              )}
              <div className="message-content">
                <div className={`message ${message.failed ? 'failed' : ''}`}>
                  {message.text}
                </div>
                <time>{message.time}</time>
                {message.suggestions && message.suggestions.length > 0 && (
                  <div className="quick-replies" aria-label="Respostas sugeridas">
                    {message.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => useSuggestion(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}

          {isSending && (
            <article className="message-row assistant typing-row" aria-label="Nora está digitando">
              <span className="message-avatar" aria-hidden="true">N</span>
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </article>
          )}

          <div ref={messagesEndRef} />
        </div>

        <footer className="composer-area">
          {!isOnline && <p className="connection-warning">Conexão perdida. Reconecte para continuar.</p>}
          <form className="composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="chat-message">Digite sua mensagem</label>
            <input
              id="chat-message"
              autoComplete="off"
              disabled={isSending || !isOnline}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={isSending ? 'Aguardando resposta…' : 'Escreva uma mensagem'}
              value={draft}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Enviar mensagem"
              disabled={!draft.trim() || isSending || !isOnline}
            >
              <span aria-hidden="true">↑</span>
            </button>
          </form>
          <p className="powered-by"><span aria-hidden="true">✦</span> Support Hub</p>
        </footer>
      </section>
    </main>
  )
}

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen])

  return (
    <aside className="chat-widget" aria-label="Atendimento virtual">
      {isOpen && (
        <div
          className="chat-widget-panel"
          id="support-chat-widget"
          role="dialog"
          aria-label="Chat com a Nora"
        >
          <button
            className="chat-widget-close"
            type="button"
            aria-label="Fechar chat"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>
          <iframe
            className="chat-widget-frame"
            src="/chatbot"
            title="Chatbot de suporte"
          />
        </div>
      )}

      <button
        className="chat-widget-launcher"
        type="button"
        aria-controls="support-chat-widget"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Fechar chat' : 'Abrir chat de suporte'}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? (
          <span aria-hidden="true">×</span>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4.5 5.75A2.75 2.75 0 0 1 7.25 3h9.5a2.75 2.75 0 0 1 2.75 2.75v7.5A2.75 2.75 0 0 1 16.75 16H10l-4.1 3.42A.85.85 0 0 1 4.5 18.77V5.75Z" />
            <path d="M8 8.25h8M8 11.5h5.5" />
          </svg>
        )}
      </button>
    </aside>
  )
}

function HostPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API indisponível')
        return response.json() as Promise<HealthResponse>
      })
      .then(setHealth)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(true)
      })

    return () => controller.abort()
  }, [])

  return (
    <>
      <main className="shell">
        <section className="card">
          <span className="eyebrow">Support Hub</span>
          <h1>Painel de atendimento</h1>
          <p>
            Acompanhe o status dos serviços. Para conversar com a Nora, abra o
            widget de suporte no canto inferior direito.
          </p>

          <div className="status" aria-live="polite">
            <span className={`status-dot ${health ? 'online' : error ? 'offline' : ''}`} />
            {health
              ? `API ${health.service} conectada`
              : error
                ? 'API indisponível'
                : 'Verificando a API…'}
          </div>
        </section>
      </main>
      <ChatWidget />
    </>
  )
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  return path === '/chatbot' ? <Chatbot /> : <HostPage />
}
