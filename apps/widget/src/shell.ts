export function renderShell(root: HTMLElement, companyName: string) {
  root.innerHTML = `
    <main aria-label="Central de suporte">
      <header>
        <div>
          <p class="eyebrow">CENTRAL DE SUPORTE</p>
          <p id="company"></p>
        </div>
        <button id="close" aria-label="Fechar central">×</button>
      </header>

      <section id="view" tabindex="-1" aria-live="polite"></section>

      <nav aria-label="Navegação da central">
        <button data-view="home">Início</button>
        <button data-view="messages">Mensagens</button>
        <button data-view="help">Ajuda</button>
      </nav>

      <footer>Uma demonstração da Support Hub</footer>
    </main>
  `

  root.querySelector<HTMLElement>('#company')!.textContent = companyName

  return {
    region: root.querySelector<HTMLElement>('#view')!,
    closeButton: root.querySelector<HTMLButtonElement>('#close')!,
    navigationButtons: root.querySelectorAll<HTMLButtonElement>('nav button'),
  }
}
