import { useEffect, useState } from 'react'
import { ChatWidget } from '../components/ChatWidget'

type HealthResponse = {
  status: 'ok'
  service: string
  timestamp: string
}

export function HostPage() {
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

