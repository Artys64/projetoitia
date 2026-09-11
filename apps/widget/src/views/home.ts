export function renderHome(region: HTMLElement, greeting: string): void {
  region.innerHTML = `
    <p class="overline">BOAS-VINDAS</p>
    <h1>Como podemos ajudar?</h1>
    <p id="greeting" class="intro"></p>

    <button class="card" data-go="messages">
      <span>
        <strong>Suas mensagens</strong>
        <small>Acompanhe suas conversas</small>
      </span>
      <span aria-hidden="true">↗</span>
    </button>

    <button class="card" data-go="help">
      <span>
        <strong>Encontre uma resposta</strong>
        <small>Conheça nossa central de ajuda</small>
      </span>
      <span aria-hidden="true">↗</span>
    </button>

    <p class="note">
      Estamos preparando um novo jeito de conversar com você.
    </p>
  `

  region.querySelector<HTMLElement>('#greeting')!.textContent = greeting
}
