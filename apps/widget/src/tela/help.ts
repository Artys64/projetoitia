export function renderHelp(region: HTMLElement): void {
  region.innerHTML = `
    <p class="overline">RESPOSTAS E ORIENTAÇÕES</p>
    <h1>Ajuda</h1>
    <p class="intro">Conteúdo demonstrativo para você explorar a central.</p>

    <details>
      <summary>Como funciona esta central?</summary>
      <p>
        Use Início, Mensagens e Ajuda para navegar. Você pode fechar e reabrir
        sem perder a seção atual.
      </p>
    </details>

    <details>
      <summary>Posso enviar uma mensagem?</summary>
      <p>
        Esta versão demonstra a instalação. Conversas, atendimento humano e IA
        serão conectados nas próximas etapas.
      </p>
    </details>

    <details>
      <summary>Meus dados ficam salvos?</summary>
      <p>
        A navegação permanece somente enquanto esta página está aberta.
        Recarregar reinicia a demonstração.
      </p>
    </details>
  `
}
