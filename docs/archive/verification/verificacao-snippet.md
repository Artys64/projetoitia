> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# Verificação da instalação por snippet

Data: 11/09/2026.

## Entrega

- `apps/loader`: script clássico sem framework; lê o ID do próprio snippet; cria botão e iframe em Shadow DOM com CSS externo; handshake, timeout de 10 segundos, fila limitada, montagem única e API `SupportHub`.
- `apps/widget`: build independente, identidade A/B e navegação Início/Mensagens/Ajuda; estado somente em memória; fechamento/ESC e transferência de foco entre origens.
- `apps/api`: entrega loader/CSS, assets com hash e `/embed/:installationId`; configuração pública validada, CSP por instalação e respostas 404/403 sem fallback.
- `apps/demo-host`: páginas A/B e comparação sem snippet, com CSP restritiva, formulário, contador, links e conteúdo rolável; nenhuma importação do painel/widget.
- `packages/contracts`: protocolo versionado e validação compartilhada de envelopes, payloads, configuração e origens.

As páginas usam produto em `http://localhost:3000` e host em `http://localhost:4174`. O chatbot do painel permanece separado. Não há envio de mensagens, histórico persistido ou integração de IA no widget desta etapa.

## Comandos verificados

`npm run check`, `npm test`, `npm run build` e `npm run sizes` passaram. A compilação da raiz respeita a dependência de contratos antes dos consumidores. Os testes de API exercitam entrega pública, cache, CSP, configuração inválida, ausência de build, instalações A/B, desconhecida e desativada.

O E2E usa builds servidos pela API, sem proxy Vite. Nesta sessão havia uma API na porta 3000; ela foi preservada, e os testes conferiram o conteúdo exato do loader antes de reutilizá-la. O host foi iniciado e encerrado pelo Playwright.

## Resultado E2E local

Execução final: **72 testes aprovados, zero falhas, zero skips e zero flaky**, em 53,9 segundos (11/09/2026, 19:23 UTC). Playwright 1.63.0, Node.js 26.5.1, Ubuntu 26.04.

| Navegador | Versão real | Viewports | Resultado |
|---|---|---|---|
| Chromium | 153.0.8010.12 | 1440×900, 390×844, 320×568 | 36/36 |
| Firefox | 155.0 | 1440×900, 390×844, 320×568 | 36/36 |
| WebKit | binário 26.6 baixado; não executado | três projetos configurados | bloqueado por dependências |

Cobertura: identidade A/B, navegação e reabertura, teclado/ESC sem clique prévio dentro do iframe, retorno de foco ao acionador e fallback ao botão, formulário/contador/links/rolagem do host, viewport e redimensionamento, repetição do snippet, conflito de ID, conflito global, limite de fila e `off`. Instalações inválidas, origem proibida, rede/CSP/CSS bloqueados e mensagens com origem, janela ou envelope forjados são rejeitados sem deixar elementos inativos no host.

A comparação com e sem loader na mesma página confirmou geometria e estilos do host iguais nos seis cenários. A coleta de Long Tasks registrou zero tarefas nas amostras do Chromium, tanto na referência quanto com snippet. O Firefox informou que não suporta essa entrada do PerformanceObserver; não há medição de tarefas longas nele. Isso é uma amostra local de carregamento, não um benchmark de produção ou de dispositivos reais.

O ajuste de foco libera o elemento anterior antes da transferência entre origens; os testes confirmam abertura por teclado, ESC e retorno ao acionador no Firefox. O iframe fechado permanece fora da navegação por teclado via `hidden` e `tabIndex=-1`.

## Bundles

Medição com `gzipSync`, sem incluir cabeçalhos HTTP. A API local entrega os bytes brutos; a medição gzip representa a compressibilidade dos arquivos, não compressão ativada no servidor.

| Recurso | Bruto | Gzip | Meta gzip |
|---|---:|---:|---:|
| Loader JS | 4.448 B | 1.979 B | <3 KB |
| Loader CSS | 1.239 B | 524 B | — |
| Widget JS | 5.106 B | 2.278 B | <80 KB |
| Widget CSS | 2.354 B | 969 B | <20 KB |

A escolha de TypeScript e DOM sem framework no iframe mantém os recursos abaixo das metas, com build e navegação próprios.

## Pendências explícitas

- **WebKit:** o binário 26.6 foi baixado, mas não iniciou por falta de `libevent-2.1-7t64`, `libavif16` e `libmanette-0.2-0`. A tentativa de `npx playwright install-deps webkit` não pôde autenticar via `sudo` sem um terminal. Instale as dependências localmente e execute `npm run test:e2e`; os nove projetos de navegador/viewport já estão configurados.
- **HTTPS externo:** a prova local não substitui a instalação em dois domínios HTTPS. Configurar instalações e origens reais antes dessa etapa; fixtures HTTP não são habilitadas automaticamente em produção.
- **Safari/iOS real:** não verificado. Viewports móveis em navegadores de desktop não demonstram suporte a aparelhos reais.

## Reprodução local

```bash
npm install
npm run demo
```

Abra `/a.html`, `/b.html` e `/without.html` em `http://localhost:4174`. Caso a API deste checkout já esteja na porta 3000, inicie apenas o host com `npm run start -w @support-hub/demo-host`.

Para os navegadores disponíveis nesta sessão (cache em `/tmp`, não versionado):

```bash
E2E_REUSE_SERVER=1 PLAYWRIGHT_BROWSERS_PATH=/tmp/support-hub-browsers \
  npx playwright test --project='chromium-*' --project='firefox-*'
```

A instalação padrão usa `npx playwright install --with-deps chromium firefox webkit` e `npm run test:e2e`. Relatório JSON, screenshots e traces de falhas são gerados em `test-results/`.
