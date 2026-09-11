# Loader do snippet

O build reúne os módulos em um único `dist/loader.js`, executado como script
clássico. A API pública continua sendo `window.SupportHub`, com os métodos
`open`, `close`, `on` e `off`.

## Responsabilidades

| Arquivo | Responsabilidade |
| --- | --- |
| `src/index.ts` | Lê o snippet, valida a instalação e registra a instância única na página. |
| `src/loader.ts` | Coordena a inicialização, a fila de comandos, o timeout e o encerramento por falha. |
| `src/events.ts` | Define a API pública, gerencia assinantes e publica erros locais e globais. |
| `src/widget-channel.ts` | Valida mensagens, negocia a conexão e correlaciona comandos com as respostas do iframe. |
| `src/view.ts` | Cria o Shadow DOM, controla a visibilidade e mantém acessibilidade e restauração de foco. |
| `src/loader.css` | Define a aparência e o comportamento responsivo do botão e do iframe. |

O coordenador conecta a interface e o canal por callbacks. O canal recebe apenas
uma função que fornece a janela de destino; ele não conhece os elementos da
interface. A interface não conhece o protocolo nem os assinantes da API.

## Fluxo de execução

1. O ponto de entrada captura `document.currentScript` durante sua execução e
   publica a API antes de aguardar o DOM.
2. A montagem adiciona o botão, a folha de estilos e o iframe. O carregamento do
   iframe inicia a negociação com o widget.
3. O loader só publica `ready` e libera a fila quando tanto o CSS quanto a conexão
   estão prontos. Há um limite de 20 comandos na fila e de 20 aguardando resposta.
4. Uma falha fatal cancela o timeout, desconecta o canal, remove a interface e
   descarta os comandos. A API permanece disponível para informar `unavailable`.

## Validação

Na raiz do monorepo:

```sh
npm run check -w @support-hub/loader
npm run build -w @support-hub/loader
npm run sizes
npm run test:e2e
```

Os testes do snippet ficam em `tests/e2e/snippet.spec.ts` e cobrem os fluxos de
integração, isolamento, teclado, foco, filas, conflitos e falhas. Consulte o
README da raiz para configurar os navegadores e reutilizar servidores locais.
