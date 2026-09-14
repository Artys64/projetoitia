import { useEffect, useState } from 'react'

export function ChatWidget() {
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

