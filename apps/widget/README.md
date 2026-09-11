# Widget incorporável

O widget roda dentro de um iframe. A configuração vem do HTML gerado pela API;
os comandos de abrir e fechar chegam da página hospedeira por `postMessage`.

## Onde alterar

- `src/index.ts`: ponto de entrada; lê a configuração e monta o widget.
- `src/config.ts`: leitura e validação da configuração pública.
- `src/widget.ts`: composição da interface, navegação, canal e eventos de teclado.
- `src/shell.ts`: estrutura fixa, identificação da empresa e referências do DOM.
- `src/navigation.ts`: seção selecionada, cliques de navegação e `aria-current`.
- `src/views/`: conteúdo de Início, Mensagens e Ajuda, em arquivos separados.
- `src/parent-channel.ts`: handshake, validação das mensagens e estado de abertura.
- `src/styles.css`: apresentação visual.

As telas recebem somente o elemento onde renderizar e os dados que usam. O canal
não acessa o DOM: solicita foco ou liberação de foco por callbacks. A navegação
mantém seu próprio estado, portanto fechar e reabrir preserva a seção atual.
`mountWidget` retorna `destroy()` para remover os listeners quando necessário.

Textos da instalação são inseridos com `textContent`. O canal aceita apenas
envelopes válidos enviados pela janela pai em uma origem autorizada. Antes de
aceitar comandos, exige `init` para a instalação correta e vincula a sessão à
instância; os comandos seguintes devem corresponder à instância e à origem.

## Verificação

Na raiz do monorepo:

```sh
npm run check -w @support-hub/widget
npm run build:embed
```

Os testes de integração do snippet estão em `tests/e2e/snippet.spec.ts`.
Consulte o README da raiz para preparar os navegadores e executar a suíte.
