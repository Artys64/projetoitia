# Plano de instalação por snippet em página externa

Data: 11/09/2026. Status: loader, widget e host externo implementados; validação local registrada em `docs/verificacao-snippet.md`. WebKit, HTTPS externo e Safari/iOS real ainda pendentes.

Este documento detalha P0/P1 da seção 9 de `PLANO_IMPLEMENTACAO_SDD.md`.

## Resultado esperado

Uma empresa copia um snippet para seu site. A página passa a exibir um botão flutuante que abre a central da empresa correta, com Início, Mensagens e Ajuda. Abrir, fechar e navegar preservam o funcionamento da página hospedeira.

## Situação no início do plano

- `apps/admin/src/App.tsx` seleciona a página hospedeira ou o chatbot em `/chatbot`; as telas ficam em `apps/admin/src/tela/`. O iframe usa uma URL relativa e demonstra incorporação na mesma origem.
- `apps/api/src/app.ts` oferece health check e chat, sem configuração de instalação ou validação de origens de incorporação.
- O proxy `/api` existe no servidor de desenvolvimento do painel; a entrega de produção do widget precisa ter roteamento próprio.
- Não existem loader público, botão flutuante externo, protocolo de comunicação ou demonstração em outra origem.

## Contrato proposto

Exemplo de produção, com endereço ilustrativo a substituir pela hospedagem real:

```html
<script
  src="https://widget.seudominio.com/loader.js"
  data-installation-id="inst_demo_a"
  defer
></script>
```

O identificador é público. Chaves de IA, tokens e outros segredos ficam no backend. O cliente não precisa instalar React, compilar código ou escrever um iframe.

### Componentes e hospedagem

| Parte | Implementação planejada |
|---|---|
| `apps/loader` | TypeScript sem framework; build como script clássico; lê atributos do próprio script e deriva sua origem de `src` |
| `apps/widget` | Interface independente do painel, com build próprio e navegação local |
| `apps/api` | Serve loader, assets e HTML do widget em `/embed/:installationId`, aplicando configuração e cabeçalhos por instalação |
| `apps/demo-host` | HTML independente servido em outra origem; não importa componentes do produto |
| Contrato compartilhado | Tipos e validação do protocolo compartilhados pelos workspaces, com ajustes explícitos no build da raiz |

Na prova local, usar produto em `http://localhost:3000` e host em `http://localhost:4174`, com portas fixas. O painel continua em `http://localhost:5173`. Para a prova inicial, a API serve os builds do loader/widget; documentar um comando para construir e iniciar a demonstração. A validação de produção deve repetir a prova em dois endereços HTTPS distintos.

Loader, HTML do iframe e seus recursos serão servidos na mesma origem do produto. O HTML por instalação terá `Cache-Control: no-store` inicialmente; assets com hash terão cache longo e o loader terá revalidação. A rota pública do embed não deve servir o painel por fallback.

### Instalação e origens

- Manter inicialmente duas configurações estáticas no servidor: `inst_demo_a` e `inst_demo_b`, cada uma com empresa, nome, saudação, cor, estado ativo e origens permitidas distintas ou explicitamente compartilhadas para a demonstração.
- Validar origens completas: protocolo, hostname e porta. Usar HTTPS em produção e liberar HTTP apenas para desenvolvimento local. Sem curingas ou comparação por sufixo.
- Incorporar no HTML somente configuração pública serializada com segurança. Validar cor e textos; não aceitar HTML ou CSS arbitrários.
- Responder instalação desconhecida com 404 e desativada com 403; nunca selecionar uma empresa padrão como fallback.
- Aplicar `Content-Security-Policy: frame-ancestors ...` no cabeçalho HTTP por instalação. Nas respostas inválidas, usar `frame-ancestors 'none'`. Verificar que proxy/hospedagem não adiciona `X-Frame-Options` incompatível.
- Documentar a liberação da origem do produto em `script-src` e `frame-src` quando o site cliente tiver CSP. Validar também a estratégia dos estilos do botão e contêiner em uma página com CSP restritiva.

A origem de uma navegação para iframe não deve ser inferida de um cabeçalho `Origin` obrigatório. A política de incorporação combina CSP no servidor e validação da origem real do remetente no handshake. Isso não autentica visitantes ou autoriza acesso a conversas. A diretiva `frame-ancestors` precisa ser enviada por cabeçalho, e verifica os ancestrais do iframe. [Referência MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

### Inicialização e API pública

1. Loader aguarda o DOM, valida atributos, cria uma instância e registra os listeners antes de carregar o iframe.
2. Carrega o iframe oculto e sem participação no foco. Após `load`, envia `init` para a origem exata do produto.
3. Widget valida `event.source === window.parent`, origem presente na configuração autorizada e envelope do protocolo; responde `ready` ao remetente validado.
4. Loader valida a janela do iframe e a origem do produto; só então disponibiliza o botão e processa os comandos pendentes.
5. Timeout inicial de 10 segundos ou erro remove os elementos inativos, libera foco e emite erro observável. Não confiar apenas em `iframe.onerror` para detectar bloqueios.

Envelope: `{ version: 1, type, requestId, instanceId, payload }`. Tipos iniciais: `init`, `ready`, `open`, `close`, `opened`, `closed`, `error`. Validar cada payload, limitar tamanho e ignorar envelopes inválidos. Identificador de instância correlaciona mensagens; não é credencial. Destinos de `postMessage` serão explícitos; validar origem, janela emissora e conteúdo em ambas as pontas. [Referência MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

API após execução do loader: `window.SupportHub.open()`, `close()`, `on(event, callback)` e `off(event, callback)`. Eventos: `ready`, `opened`, `closed`, `error`. Antes de `ready`, enfileirar até 20 comandos; excedente emite erro. Documentar que chamadas anteriores ao carregamento do próprio script aguardam seu evento `load`. O integrador pode observar erro de download pelo evento `error` do elemento script, quando a API ainda não existe.

Repetir o mesmo snippet não duplica instância, botão ou listeners. Nesta entrega, uma instalação por documento: um segundo ID diferente gera conflito explícito e preserva a primeira instalação. Demonstrar A e B em páginas distintas. Se `window.SupportHub` já pertencer a outro código, falhar de forma controlada sem sobrescrevê-lo.

### Interface e comportamento

- Botão flutuante no canto inferior direito; painel limitado à viewport, com fechamento sempre acessível. Isolar estilos do botão/contêiner e evitar seletores globais no host.
- Início exibe identidade e saudação da empresa; Mensagens exibe estado vazio; Ajuda exibe conteúdo demonstrativo identificado.
- Fechar mantém a navegação local em memória e oculta o iframe do foco e dos cliques. Reabrir restaura a view; recarregar reinicia essa demonstração.
- Abrir move o foco para a central; fechar ou pressionar ESC no iframe devolve ao controle que abriu, com fallback para o botão flutuante se o elemento original deixou de existir.
- Respeitar movimento reduzido, teclado, áreas seguras e redimensionamento. Não bloquear rolagem global, alterar URL/histórico do host ou inserir overlay invisível.
- O chatbot existente continua disponível como demonstração separada. O widget desta etapa segue o escopo P1 já registrado: envio real, histórico, atendimento humano e IA serão conectados nas etapas posteriores.

## Sequência de implementação

1. **Contratos e fixtures:** registrar configuração A/B, estados inválidos, origens, tipos de mensagens e validação; preparar testes da API e protocolo.
2. **Entrega dos recursos:** criar builds do loader/widget, servir os arquivos pela API e aplicar CSP/configuração na rota do embed; conferir o build de produção sem depender do proxy Vite.
3. **Integração:** implementar montagem única, handshake, timeout, API pública, abrir/fechar, foco e recuperação de falhas.
4. **Navegação:** implementar Início/Mensagens/Ajuda com identidade por instalação e comportamento responsivo.
5. **Demonstração externa:** criar páginas A/B com snippet, estilos próprios, link, formulário, contador e conteúdo rolável; incluir página sem snippet para comparação.
6. **Verificação e documentação:** executar matriz abaixo, corrigir falhas, registrar evidências e atualizar README com snippet, origens e comandos reproduzíveis.

## Critérios de conclusão

- Instalar somente o snippet em outra origem mostra a empresa correta; repetição não duplica o widget.
- Abrir, fechar, reabrir, navegar e ESC funcionam por mouse e teclado; foco retorna ao controle certo.
- Formulário, contador, links e rolagem do host continuam operando; o estado fechado não captura cliques fora do botão.
- Origem proibida, ID inexistente/desativado, conflito de instalação e mensagens forjadas são rejeitados; nada exibe configuração de outra empresa.
- Falha de rede, CSP bloqueando iframe e timeout deixam erro observável e nenhuma área invisível capturando eventos.
- Executar testes E2E em Chromium, Firefox e WebKit, em desktop 1440×900 e móvel 390×844, mais verificação de viewport estreita 320×568 e redimensionamento. Registrar versões reais; emulação não substitui verificação em Safari/iOS antes de declarar suporte nesse ambiente.
- Repetir o fluxo de instalação e navegação em duas origens HTTPS. Até essa etapa existir, registrar somente a prova cross-origin local como concluída.
- Executar `npm run check`, `npm test` e `npm run build`, além dos novos testes de integração/E2E.
- Comparar carregamento com e sem snippet: bytes brutos/gzip, tarefas longas atribuíveis ao loader e alterações visuais no host. Metas do SDD: loader <3 KB gzip, JS inicial do iframe <80 KB gzip e CSS <20 KB gzip. Revisar explicitamente o plano se os resultados exigirem mudança.

O domínio real de hospedagem será definido na preparação da prova HTTPS. Isso não bloqueia contratos, implementação e validação local. Nenhum domínio ilustrativo deste plano representa uma instalação publicada.
