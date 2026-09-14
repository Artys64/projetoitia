import type { FormEvent } from 'react'

type ChatComposerProps = {
  draft: string
  isSending: boolean
  isOnline: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
}

export function ChatComposer({ draft, isSending, isOnline, onDraftChange, onSend }: ChatComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSend()
  }

  return (
    <footer className="composer-area">
      {!isOnline && <p className="connection-warning">Conexão perdida. Reconecte para continuar.</p>}
      <form className="composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="chat-message">Digite sua mensagem</label>
        <input
          id="chat-message"
          autoComplete="off"
          disabled={isSending || !isOnline}
          maxLength={500}
          onChange={(event) => onDraftChange(event.target.value)}
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
  )
}
