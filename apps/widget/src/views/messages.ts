export function renderMessages(region: HTMLElement): void {
  region.innerHTML = `
    <p class="overline">SUAS CONVERSAS</p>
    <h1>Mensagens</h1>

    <div class="empty">
      <span class="empty-icon" aria-hidden="true">○</span>
      <h2>Nenhuma conversa por aqui</h2>
      <p>Quando você iniciar uma conversa, ela aparecerá nesta área.</p>
    </div>

    <p class="note">
      Demonstração: o envio de mensagens e o histórico estarão disponíveis
      em uma próxima etapa.
    </p>
  `
}
