import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeFormat, KnowledgeItem, KnowledgeWrite } from '@support-hub/contracts'
import { adminApi, AdminApiError, type AdminSession } from '../services/knowledge'

type Form = KnowledgeWrite & { id: string | null; revision: number | null }

const emptyForm = (): Form => ({ id: null, revision: null, title: '', content: '', format: 'text', sourceName: null })

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
}

function stateLabel(item: KnowledgeItem) {
  if (item.publication?.state === 'queued') return 'Na fila'
  if (item.publication?.state === 'indexing') return `Indexando ${item.publication.progress}%`
  if (item.publication?.state === 'failed') return 'Falha na indexação'
  if (!item.publishedVersion) return 'Rascunho'
  if (item.hasUnpublishedChanges) return 'Alterações pendentes'
  return 'Publicado'
}

function itemForm(item: KnowledgeItem): Form {
  return {
    id: item.id, revision: item.draftRevision, title: item.title, content: item.content,
    format: item.format, sourceName: item.sourceName,
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (date.getUTCFullYear() === 1970) return 'Conteúdo publicado'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function KnowledgePage() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready' | 'unavailable'>('loading')
  const [token, setToken] = useState('')
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [form, setForm] = useState<Form>(emptyForm)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadItems = async () => {
    const response = await adminApi.list()
    setItems(response.items)
    if (form.id) {
      const current = response.items.find(item => item.id === form.id)
      if (current && !dirty) setForm(itemForm(current))
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    adminApi.session()
      .then(async current => {
        if (controller.signal.aborted) return
        setSession(current)
        setPhase('ready')
        const response = await adminApi.list()
        if (!controller.signal.aborted) setItems(response.items)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof AdminApiError && error.status === 401) setPhase('login')
        else setPhase('unavailable')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (phase !== 'ready' || !items.some(item => ['queued', 'indexing'].includes(item.publication?.state ?? ''))) return
    const timer = window.setInterval(() => void loadItems().catch(() => undefined), 1500)
    return () => window.clearInterval(timer)
  }, [phase, items])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try { await work() }
    catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        setSession(null)
        setPhase('login')
      }
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível concluir a operação.' })
    } finally { setBusy(false) }
  }

  const login = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const current = await adminApi.login(token)
      setSession(current)
      setToken('')
      setPhase('ready')
      const response = await adminApi.list()
      setItems(response.items)
    })
  }

  const choose = (item: KnowledgeItem) => {
    if (dirty && !window.confirm('Descartar as alterações que ainda não foram salvas?')) return
    setForm(itemForm(item))
    setDirty(false)
    setPreview(false)
    setNotice(null)
  }

  const updateForm = (patch: Partial<Form>) => {
    setForm(current => ({ ...current, ...patch }))
    setDirty(true)
  }

  const persist = async () => {
    const value = {
      title: form.title, content: form.content, format: form.format, sourceName: form.sourceName,
    }
    const saved = form.id
      ? await adminApi.update(form.id, { ...value, expectedRevision: form.revision })
      : await adminApi.create(value)
    setForm(itemForm(saved))
    setDirty(false)
    await loadItems()
    return saved
  }

  const save = () => void run(async () => {
    await persist()
    setNotice({ tone: 'success', text: 'Rascunho salvo. A versão publicada não foi alterada.' })
  })

  const publish = () => void run(async () => {
    const saved = dirty || !form.id ? await persist() : items.find(item => item.id === form.id)
    if (!saved?.id || !saved.draftRevision) throw new Error('Salve o conteúdo antes de publicar.')
    const published = await adminApi.publish(saved.id, saved.draftRevision)
    setForm(itemForm(published))
    setDirty(false)
    await loadItems()
    setNotice({ tone: 'success', text: 'Publicação solicitada. A versão atual continua ativa até a indexação terminar.' })
  })

  const unpublish = () => void run(async () => {
    if (!form.id || !window.confirm('Despublicar este conteúdo da base da Nora?')) return
    const changed = await adminApi.unpublish(form.id)
    setForm(itemForm(changed))
    await loadItems()
    setNotice({ tone: 'success', text: 'Conteúdo removido da base publicada.' })
  })

  const deleteArticle = () => {
    if (!form.id || !window.confirm(`Apagar permanentemente “${form.title}”? O rascunho e todas as versões publicadas serão excluídos.`)) return
    void run(async () => {
      await adminApi.delete(form.id!)
      setForm(emptyForm())
      setDirty(false)
      setPreview(false)
      await loadItems()
      setNotice({ tone: 'success', text: 'Artigo apagado permanentemente.' })
    })
  }

  const importFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void run(async () => {
      if (file.size > 1_048_576) throw new Error('O arquivo deve ter no máximo 1 MiB.')
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (!['md', 'markdown', 'txt'].includes(extension ?? '')) throw new Error('Envie um arquivo .md ou .txt.')
      let content: string
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
      catch { throw new Error('O arquivo precisa estar codificado em UTF-8.') }
      if (!content.trim()) throw new Error('O arquivo está vazio.')
      if (content.length > 200_000) throw new Error('O documento deve ter no máximo 200.000 caracteres.')
      if (dirty && !window.confirm('Descartar as alterações que ainda não foram salvas?')) return
      const title = file.name.replace(/\.(?:md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ')
      setForm({ id: null, revision: null, title, content, format: extension === 'txt' ? 'text' : 'markdown', sourceName: file.name })
      setDirty(true)
      setPreview(false)
      setNotice({ tone: 'success', text: 'Arquivo carregado. Revise o texto antes de publicar.' })
    })
  }

  if (phase === 'loading') return <main className="admin-gate"><div className="gate-card"><span className="gate-spinner" />Carregando painel…</div></main>

  if (phase === 'unavailable') return (
    <main className="admin-gate">
      <section className="gate-card gate-error">
        <div className="brand-mark">N</div>
        <h1>Base administrativa indisponível</h1>
        <p>Conecte a API ao PostgreSQL e recarregue esta página.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>Tentar novamente</button>
      </section>
    </main>
  )

  if (phase === 'login') return (
    <main className="admin-gate">
      <form className="gate-card login-card" onSubmit={login}>
        <div className="brand-mark">N</div>
        <span className="section-kicker">Administração</span>
        <h1>Acesse a base da Nora</h1>
        <p>Use a chave de acesso emitida para a empresa. Ela fica protegida em uma sessão do navegador.</p>
        <label htmlFor="access-token">Chave de acesso</label>
        <input id="access-token" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" required />
        {notice && <div className={`notice ${notice.tone}`} role="alert">{notice.text}</div>}
        <button className="primary-button" disabled={busy || token.trim().length !== 43}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )

  const selected = items.find(item => item.id === form.id)
  const canSubmit = form.title.trim().length > 0 && form.content.trim().length > 0 && form.content.length <= 200_000

  return (
    <main className="knowledge-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/" aria-label="Nora Admin"><span className="brand-mark small">N</span><span>Nora <b>Admin</b></span></a>
        <nav aria-label="Navegação principal">
          <a className="nav-item active" href="/">
            <Icon><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5v16M8 7h8M8 11h8" /></Icon>
            Base de conhecimento
          </a>
          <a className="nav-item" href="/chatbot">
            <Icon><path d="M4 5h16v12H8l-4 4zM8 9h8M8 13h5" /></Icon>
            Testar Nora
          </a>
        </nav>
        <div className="sidebar-foot">
          <span>Empresa ativa</span>
          <strong>{session?.companyId}</strong>
          <button onClick={() => void run(async () => { await adminApi.logout(); setPhase('login'); setSession(null) })}>Sair</button>
        </div>
      </aside>

      <section className="knowledge-workspace">
        <header className="workspace-header">
          <div><span className="section-kicker">Contexto da IA</span><h1>Base de conhecimento</h1><p>Somente conteúdos publicados são usados nas respostas da Nora.</p></div>
          <div className="header-actions">
            <input ref={fileInput} className="sr-only" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={importFile} />
            <button className="secondary-button" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4" /></Icon>Importar arquivo
            </button>
            <button className="primary-button" onClick={() => {
              if (dirty && !window.confirm('Descartar as alterações que ainda não foram salvas?')) return
              setForm(emptyForm()); setDirty(false); setPreview(false); setNotice(null)
            }}><span aria-hidden="true">＋</span>Novo texto</button>
          </div>
        </header>

        <div className="knowledge-grid">
          <aside className="document-library" aria-label="Conteúdos da base">
            <div className="library-heading"><h2>Conteúdos</h2><span>{items.length}</span></div>
            <div className="document-list">
              {items.length === 0 && <div className="empty-list"><Icon><path d="M5 3h10l4 4v14H5zM15 3v5h5M8 13h8M8 17h6" /></Icon><strong>A base está vazia</strong><span>Crie um texto ou importe um Markdown.</span></div>}
              {items.map(item => <button key={item.id} className={`document-row ${form.id === item.id ? 'selected' : ''}`} onClick={() => choose(item)}>
                <span className={`status-pill ${item.publication?.state === 'failed' ? 'draft' : item.publication && ['queued','indexing'].includes(item.publication.state) ? 'pending' : item.publishedVersion ? item.hasUnpublishedChanges ? 'pending' : 'published' : 'draft'}`}>{stateLabel(item)}</span>
                <strong>{item.title}</strong>
                <small>{item.format === 'markdown' ? 'Markdown' : 'Texto'} · {formatDate(item.updatedAt)}</small>
              </button>)}
            </div>
          </aside>

          <section className="editor-panel" aria-label="Editor de conteúdo">
            <div className="editor-toolbar">
              <div className="segmented" aria-label="Modo do editor">
                <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Editar</button>
                <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Visualizar</button>
              </div>
              <div className="editor-actions">
                {selected?.publishedVersion && <button className="text-button danger" onClick={unpublish} disabled={busy}>Despublicar</button>}
                {selected && <button className="delete-button" onClick={deleteArticle} disabled={busy}>
                  <Icon><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></Icon>
                  Apagar
                </button>}
                <button className="secondary-button compact" onClick={save} disabled={busy || !dirty || !canSubmit}>{busy ? 'Salvando…' : 'Salvar rascunho'}</button>
                <button className="publish-button" onClick={publish} disabled={busy || !canSubmit}>{busy ? 'Publicando…' : 'Publicar'}</button>
              </div>
            </div>

            {notice && <div className={`notice ${notice.tone}`} role="status">{notice.text}</div>}

            <div className="editor-fields">
              <div className="title-line">
                <label htmlFor="knowledge-title">Título</label>
                <select aria-label="Formato" value={form.format} onChange={event => updateForm({ format: event.target.value as KnowledgeFormat })}>
                  <option value="text">Texto</option><option value="markdown">Markdown</option>
                </select>
              </div>
              <input id="knowledge-title" className="title-input" value={form.title} placeholder="Ex.: Política de trocas" maxLength={160} onChange={event => updateForm({ title: event.target.value })} />
              {form.sourceName && <div className="source-chip"><Icon><path d="M7 3h7l4 4v14H7zM14 3v5h5" /></Icon>{form.sourceName}</div>}
              {preview ? (
                <div className="content-preview" tabIndex={0}>{form.content || 'Nada para visualizar.'}</div>
              ) : (
                <textarea className="content-editor" aria-label="Conteúdo que será usado pela IA" value={form.content} placeholder={form.format === 'markdown' ? '# Escreva ou cole seu Markdown aqui' : 'Escreva ou cole o contexto que a Nora deve consultar…'} maxLength={200000} onChange={event => updateForm({ content: event.target.value })} />
              )}
              <footer className="editor-meta"><span>{form.content.length.toLocaleString('pt-BR')} / 200.000 caracteres</span><span>{dirty ? 'Alterações ainda não salvas' : selected?.hasUnpublishedChanges ? 'Rascunho salvo' : selected?.publishedVersion ? `Versão ${selected.publishedVersion} publicada` : 'Novo rascunho'}</span></footer>
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
