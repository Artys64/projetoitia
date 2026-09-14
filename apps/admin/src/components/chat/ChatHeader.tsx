type ChatHeaderProps = { isOnline: boolean }

export function ChatHeader({ isOnline }: ChatHeaderProps) {
  return (
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
  )
}
