import { useEffect, useRef } from 'react'
import type { Message } from '../../types/chat'

type MessageListProps = {
  messages: Message[]
  isSending: boolean
  onSuggestion: (suggestion: string) => void
}

export function MessageList({ messages, isSending, onSuggestion }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  return (
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
                    onClick={() => onSuggestion(suggestion)}
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
  )
}
