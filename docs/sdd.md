Aqui está a **Especificação Técnica V2 refatorada**, agora adotando a **arquitetura baseada em `iframe`**. 

Mudar de Web Components (Shadow DOM) para `iframe` altera significativamente como o widget é injetado, isolado e como ele se comunica com o site hospedeiro (através de `postMessage`). Esta nova versão detalha como lidar com os desafios clássicos do iframe (redimensionamento dinâmico, comunicação cross-origin e políticas de frame).

---

# Especificação Técnica V2: Arquitetura do Client (Iframe), Resiliência e Integração

## 1. Arquitetura do Core do Widget (Client-Side)

Para garantir isolamento absoluto (zero conflito de CSS/JS com o site hospedeiro) e máxima segurança, o widget será renderizado dentro de um **`iframe` cross-origin**. O site do cliente carregará apenas um script inicializador extremamente leve (`loader.js`).

### 1.1. Isolamento via Iframe e Redimensionamento Dinâmico (Resize Observer)
O `loader.js` criará um elemento `<iframe>` invisível e o injetará no `<body>` do site cliente. 
* **Zero Conflito:** Como o iframe roda em seu próprio contexto de documento (ex: `widget.supporthub.com`), é fisicamente impossível que o CSS do site cliente quebre o layout do chat e vice-versa.
* **Redimensionamento Inteligente:** Um grande desafio de iframes é que eles bloqueiam os cliques na página hospedeira. 
  * Quando o painel estiver **fechado** (apenas o botão visível), o iframe terá um tamanho reduzido (ex: `80x80px`).
  * Quando o usuário clicar para **abrir**, o iframe enviará um evento via `postMessage` para o `loader.js`, que expandirá o `width` e `height` do iframe dinamicamente (ex: `400x700px`).
* **Acessibilidade (a11y):** A tecla `ESC` pressionada *dentro* do iframe disparará um `postMessage` para o host, solicitando a redução do iframe e devolvendo o foco (FocusTrap) para a página original.

### 1.2. Sincronização Multi-Abas (BroadcastChannel API nativo)
Um problema comum é o usuário ter várias abas do site abertas. 
* Como todos os iframes injetados nas diferentes abas estarão no **mesmo domínio** (`widget.supporthub.com`), o widget utilizará a `BroadcastChannel API` nativa de forma transparente.
* **Funcionamento:** Quando o iframe da aba principal recebe uma nova mensagem (WebSocket), ele dispara um evento no canal `supporthub_sync_{tenant_id}`. Os iframes das outras abas escutam e atualizam a UI sem precisar de conexões duplicadas de WebSocket com o servidor.

---

## 2. Motor de Renderização de Mensagens e Citações (Deep Linking)

A IA usará o conteúdo da base de conhecimento (em formato Markdown) e citará links dos artigos. A experiência de clique ocorrerá inteiramente dentro do iframe.

### 2.1. O Ciclo do Link de Citação
1. **Geração (LLM):** O modelo gera um texto como: `Você pode conferir os detalhes no artigo [Políticas de Reembolso](hub://article/politicas-de-reembolso).`
2. **Parsing no Iframe:** O JS dentro do iframe recebe o stream, compila o Markdown usando DOMPurify para evitar XSS e intercepta links com o protocolo `hub://article/`.
3. **Renderização:** O link vira um botão de ação com ícone de documento.
4. **Interação de Clique:** 
   * Ao clicar, o gerenciador de estado do iframe altera a `View` interna de `Messages` para `Help`.
   * Um Skeleton Loader é exibido enquanto o artigo é buscado.
   * O artigo é renderizado com um botão "← Voltar para a conversa" fixo no topo. **Nenhum redirecionamento de página ocorre**, mantendo o usuário na mesma aba do host.

---

## 3. Máquina de Estados Local (Iframe State Machine)

O JS que roda dentro do iframe possui uma máquina de estados finita que controla os inputs, botões e os eventos de expansão/retração solicitados ao host.

| Estado da UI | Condição / Gatilho | Comportamento da Interface |
|---|---|---|
| `IDLE` | Nenhuma conversa ativa. | Input habilitado. |
| `STREAMING` | IA gerando resposta via SSE. | Input bloqueado. Indicador de digitação animado. |
| `RAG_FALLBACK` | IA não encontrou resposta. | Exibe botões de ação (Quick Replies): *"Falar com equipe"* ou *"Refazer busca"*. |
| `WAITING_AGENT` | Usuário pediu humano. | Input bloqueado. Barra de status: *"Aguardando equipe..."* |
| `AGENT_TYPING` | Humano digitando (WSS). | Input liberado. Mostra *"Nome do Agente está digitando..."*. |
| `RESOLVED` | Agente encerrou o ticket. | Input bloqueado. Card de CSAT (👍 / 👎). Reseta para `IDLE` após voto. |

---

## 4. Gestão de Rede e Resiliência (Edge Cases)

Como o iframe roda isolado, a resiliência de rede é gerenciada de forma autônoma pelo documento embutido.

### 4.1. Reconexão e Offline Graceful Degradation
* **Falha de Rede:** O iframe detecta `navigator.onLine === false`. O input é desativado com a mensagem *"Conexão perdida..."*.
* **Reconexão WSS:** Backoff Exponencial (1s, 2s, 4s, 8s) a partir do iframe para o backend.
* **Sincronização:** Após reconectar, o iframe faz um REST GET para buscar mensagens perdidas durante o período offline.

### 4.2. Usuário Fecha a Página Durante a Resposta
* Se o usuário fechar a aba hospedeira (destruindo o iframe no processo) enquanto a IA processa o SSE, o backend continua gerando a resposta e salva no banco. 
* No próximo acesso, o iframe é reinjetado, carrega o cookie de sessão com atributo `SameSite=None; Secure`, busca o histórico completo e avisa o host (via postMessage) para exibir o "badge" vermelho no botão do widget.

---

## 5. Event Bus cross-origin (Client Developer API e `postMessage`)

O `loader.js` expõe a API `window.SupportHub` para o desenvolvedor do site cliente. Por trás dos panos, essa API atua como um mensageiro bidirecional usando `window.postMessage` entre a página host e o `iframe`.

### 5.1. Comunicação Host ↔ Iframe
O desenvolvedor do site interage apenas com a API amigável:

```javascript
// Exemplo de integração no site da empresa cliente
window.SupportHub.on('ready', () => {
  console.log('Iframe carregado e central pronta.');
});

window.SupportHub.on('message:sent', (data) => {
  // O iframe enviou um postMessage para o host avisando do envio
  analytics.track('Support Message Sent', { isHumanRequested: data.handoff });
});

// Passando contexto para dentro do iframe
// O loader converte isso em: iframe.contentWindow.postMessage({ type: 'SET_CONTEXT', payload: ... })
window.SupportHub.setContext({ page: 'checkout', cartValue: 200 }); 
window.SupportHub.open(); // Dispara postMessage para o iframe alterar seu estado interno, e o iframe pede ao host para aumentar sua largura/altura.
```

---

## 6. Fluxos de Segurança, CSP e Frame-Ancestors

A arquitetura baseada em Iframe exige configurações HTTP rígidas para evitar vulnerabilidades como Clickjacking.

* **Content-Security-Policy (CSP):** O documento HTML servido dentro do iframe enviará o cabeçalho `Content-Security-Policy: frame-ancestors 'self' https://*.sitecliente.com;`. Isso garante que apenas clientes cadastrados no painel administrativo possam embutir o iframe.
* **SameSite Cookies:** Para que o widget consiga manter a sessão do usuário em navegadores rigorosos (como Safari com ITP e Chrome moderno), os cookies de autenticação da sessão do chat usarão `SameSite=None; Secure`.
* **Sanitização de Markdown:** Continuará usando DOMPurify dentro do iframe, prevenindo XSS antes da conversão.

---

## 7. A Experiência do Administrador (Backend / Painel Inbox)

Permanece igual à versão original, sendo abastecida pelo contexto enviado pelo iframe e pelo `setContext`.

1. **Card de Contexto da Página:** Mostra de qual URL o iframe enviou a requisição e variáveis do site.
2. **Resumo da IA (Handoff Summary):** IA resume a conversa no momento em que o transbordo ocorre no iframe.
3. **Draft Automático:** O foco visual no painel admin reduz o esforço do atendente humano.

---

## 8. Estratégia de Deploy e Orçamento de Performance (Budget)

A abordagem de iframe traz vantagens imensas de performance para o **site hospedeiro**, pois o carregamento pesado é deferido.

### 8.1. Arquitetura de Entrega (CDN)
| Recurso / Arquivo | Tamanho | Função |
|---|---|---|
| `loader.js` (Host) | **< 3 KB** | Único script na página do cliente. Apenas injeta o `<iframe>`, gerencia a API `window.SupportHub` e redimensiona o iframe ouvindo `postMessage`. Zero impacto no tempo de carregamento da página principal. |
| `iframe.html` (Iframe) | ~ 2 KB | Documento base embutido. |
| `app.js` (Iframe) | < 80 KB | Carregado *dentro* do iframe de forma assíncrona. Contém a máquina de estados, Markdown parser, lógicas de RAG e conexão WebSocket. |
| `app.css` (Iframe) | < 20 KB | CSS padrão. Pode ser customizado injetando as cores da marca (repassadas via querystring pelo `loader.js`, ex: `?primaryColor=ff0000`). |

### 8.2. Fases de Lançamento
1. **Fase Alpha (Interna):** Foco estrito em testar o **redimensionamento dinâmico** do iframe (garantindo que o site por baixo não perca cliques) e a estabilidade dos cookies `SameSite=None` em Safari e dispositivos iOS.
2. **Fase Beta:** Instalação do `loader.js` em parceiros. Acompanhamento via telemetria sobre o sucesso da comunicação `postMessage` e estabilidade do fluxo de RAG no novo formato encapsulado.
