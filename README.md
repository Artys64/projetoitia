# Support Hub

Monorepo TypeScript com painel React, API Fastify e central de suporte instalável por snippet, com loader e widget independentes.

## Requisitos

- Node.js 22 ou superior
- npm 11 ou superior

## Executar localmente

```bash
npm install
npm run dev
```

- Painel: http://localhost:5173
- API: http://localhost:3000
- Health check (também disponível pelo proxy do Vite): http://localhost:5173/api/health

## Comandos

```bash
npm run dev      # inicia painel e API
npm run check    # valida os tipos
npm test         # executa os testes
npm run build    # gera os builds de produção
```

## Estrutura

```text
apps/
  admin/  React + Vite
  api/    Fastify
```

Copie `apps/api/.env.example` para `apps/api/.env` caso queira alterar a porta ou o endereço da API.

## Testar com a Groq

Com a Groq, a Nora interpreta o histórico e decide se responde diretamente, pede esclarecimento ou consulta artigos publicados pela ferramenta `searchKnowledge`. Sem chave, funciona apenas como busca textual e mostra o primeiro trecho encontrado. Para ativar o GPT-OSS 20B pela Groq:

1. Crie uma chave no [GroqCloud Console](https://console.groq.com/keys).
2. Copie `apps/api/.env.example` para `apps/api/.env.local`.
3. Preencha `GROQ_API_KEY` no arquivo `.env.local`.
4. Reinicie `npm run dev`.

O modelo padrão é `openai/gpt-oss-20b`. Para usar outro modelo disponível na Groq, altere `GROQ_MODEL`; ele precisa suportar chamadas de ferramentas. Mantenha a chave somente no backend e não a envie para o repositório.

No Free Plan, a Groq atualmente informa para esse modelo os limites de 30 requests/minuto, 1.000 requests/dia, 8.000 tokens/minuto e 200.000 tokens/dia. Os limites são compartilhados pela organização e podem mudar; confira sempre a [página oficial de limites](https://console.groq.com/docs/rate-limits) e os valores exibidos na sua conta.

## RAG conversacional com base local

A base fica em `apps/api/knowledge/articles.json`. Edite esse arquivo e reinicie a API para aplicar alterações. Para usar outro arquivo, configure `KNOWLEDGE_FILE` com um caminho absoluto em `apps/api/.env.local`. Arquivo inválido impede a inicialização, em vez de usar silenciosamente outra base.

Cada artigo tem este formato:

```json
{
  "id": "exportar-relatorios",
  "companyId": "support-hub",
  "version": 1,
  "status": "published",
  "title": "Exportar relatórios",
  "keywords": ["exportar", "relatorio", "csv"],
  "content": "Na área de relatórios, selecione Exportar para baixar um CSV.",
  "suggestions": ["Voltar ao início"]
}
```

O exemplo ilustra o formato; publique apenas informações verificadas do seu produto. Incremente `version` ao alterar o conteúdo. Use `status: "draft"` para excluir um artigo da busca. A versão inicial inclui cinco artigos demonstrativos derivados das informações que já estavam no prompt.

O servidor cria um índice textual em memória na inicialização, com trechos de até 900 caracteres. A busca normaliza acentos e prioriza título e palavras-chave. Cada chamada recupera até quatro trechos, com até 5.000 caracteres no JSON de contexto; isso é um limite de caracteres, não de tokens. Os limiares de pontuação são heurísticos, não uma medida de certeza. Sinônimos podem ser adicionados em `keywords`.

O endpoint continua recebendo `{ "message": "..." }` ou `{ "messages": [...] }` e devolvendo `{ "reply": "...", "suggestions": [...] }`. Com IA ativa, todas as mensagens passam pelo modelo com até 12 mensagens de histórico, sem roteamento por listas de frases. O modelo pode responder a uma interação social ou pedir esclarecimento sem buscar. Para dúvidas sobre o produto, o prompt exige consultar `searchKnowledge`, formulando uma pergunta autossuficiente com o contexto relevante. O histórico ajuda a interpretar a intenção, mas não é uma fonte verificada de fatos do produto. A empresa é fixada no servidor e não faz parte dos argumentos da ferramenta.

Uma busca sem resultados é devolvida ao modelo, que pode reformular a consulta, esclarecer a dúvida ou explicar a falta de informação. Uma correspondência textual não garante cobertura; o prompt orienta a IA a verificar a relevância e não inventar fatos. Essas regras de fundamentação são instruções ao modelo, não uma garantia determinística contra alucinações. O ciclo usa `ToolLoopAgent` com até duas buscas e três etapas de geração, desabilitando ferramentas na última etapa. O prazo de 20 segundos vale para a interação inteira. Interações sociais também consomem tokens, e consultas à base normalmente exigem mais de uma chamada ao modelo.

As sugestões vêm do primeiro trecho recuperado; sem trechos, a resposta gerada retorna uma lista vazia. Falhas de busca retornam 503 e falhas de geração retornam 502. Sem chave (ou com `useLlm: false`), permanece o modo de busca literal: ele usa a última pergunta, acrescenta a anterior em continuações explícitas e retorna uma mensagem fixa quando não encontra trechos. Esse modo não interpreta respostas breves como o modelo.

Os logs de sucesso registram IDs e versões das fontes selecionadas, versão do prompt, resultado da execução e, nas gerações, modelo, número de buscas/etapas e uso total de tokens de todas as etapas. O conteúdo das perguntas, consultas e artigos não é incluído explicitamente nesses logs de sucesso. Os testes com provedor simulado validam o histórico, a execução das ferramentas, a filtragem por empresa/publicação, consultas vazias, limites e erros. A qualidade da interpretação precisa também de avaliação com o modelo real.

Para testar no chat existente, pergunte “Esqueci minha senha”, “Quais são os planos?” e uma pergunta fora da base. Teste também uma resposta curta à pergunta da Nora, um agradecimento e uma recusa. O comportamento depende do histórico: “não” após uma oferta de ajuda pode encerrar a conversa; após uma pergunta sobre recebimento de e-mail pode levar à consulta desse problema. Também é possível testar diretamente:

```bash
curl http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Como instalar o widget?"}'
```

Esta etapa atende à demonstração de uma única empresa: `KNOWLEDGE_COMPANY_ID` é definido no servidor (padrão `support-hub`), nunca pelo corpo da requisição. Use apenas conhecimento público nesse endpoint, que ainda não tem autenticação. A filtragem por empresa na busca não substitui autenticação e autorização. O widget incorporável continua demonstrativo; o chat funcional está no painel em `/chatbot`.

O índice permanece como uma fotografia do arquivo até reiniciar o processo; despublicar exige reiniciar todas as instâncias. Gestão de artigos pelo painel, atualização em tempo real, fontes clicáveis, persistência de auditoria e resolução de empresa por sessão autenticada ficam para próximas etapas. Para migrar a recuperação para PostgreSQL, implemente `KnowledgeSearch` em `apps/api/src/knowledge/search.ts`, mantendo a filtragem de empresa/publicação e o contrato de retorno. A implementação atual não usa banco, embeddings nem novas dependências.

## Instalação por snippet (demonstração local)

```bash
npm install
npm run demo
```

Esse comando compila contratos, loader, widget, API e painel e inicia dois servidores com portas fixas:

- Produto/API: `http://localhost:3000`.
- Host externo A: `http://localhost:4174/a.html` (`inst_demo_a`, Aurora Studio).
- Host externo B: `http://localhost:4174/b.html` (`inst_demo_b`, Jardim & Casa).
- Comparação sem snippet: `http://localhost:4174/without.html`.

O painel e seu chatbot continuam disponíveis com `npm run dev` em `http://localhost:5173` e `/chatbot`. Não execute `dev` e `demo` juntos: ambos usam a porta 3000. `npm run build:embed` recompila somente os contratos e os recursos do snippet; recarregue a página após editar loader/widget.

O host é HTML independente: não importa componentes nem depende do proxy Vite. Para instalar na origem local autorizada, basta:

```html
<script
  src="http://localhost:3000/loader.js"
  data-installation-id="inst_demo_a"
  defer
></script>
```

A origem do produto é derivada de `src`. O loader carrega `/loader.css` e `/embed/:installationId` nessa origem. A configuração pública do iframe contém apenas identidade, saudação, cor e origens autorizadas. Nenhuma chave de IA faz parte do snippet.

### API pública e erros

Após o evento `load` do script, `window.SupportHub` oferece `open()`, `close()`, `on(event, callback)` e `off(event, callback)`. Os eventos são `ready`, `opened`, `closed` e `error`; o callback recebe o payload. `closed` informa `reason: 'command' | 'dismiss'`; `error` informa `code` e `message`.

```js
const script = document.querySelector('script[data-installation-id]')
script.addEventListener('load', () => {
  window.SupportHub.on('error', ({ code }) => console.error(code))
  window.SupportHub.open()
})
script.addEventListener('error', () => console.error('Falha ao baixar o loader'))
window.addEventListener('supporthub:error', event => console.error(event.detail.code))
```

Registre esses listeners antes de o script terminar de carregar (a demonstração usa um script `defer` anterior ao loader). Os eventos não são reproduzidos para listeners registrados depois. `open` e `close` aguardam `ready`, com até 20 comandos pendentes. O handshake tem limite de 10 segundos. Falhas removem o botão/iframe e ficam observáveis pelo evento global `supporthub:error`, inclusive conflitos anteriores à criação da API, e pelo console. Após falha fatal, recarregue para tentar novamente.

Repetir o mesmo snippet preserva uma única instância. Um ID diferente emite `installation_conflict` e mantém a primeira instalação. Um `window.SupportHub` preexistente é preservado (`global_conflict`). Fechar ou usar ESC preserva a seção selecionada e devolve o foco ao acionador; recarregar reinicia a navegação. Mensagens e Ajuda são demonstrativas, sem envio ou persistência de conversas.

### Origens, CSP e produção

As fixtures estão em `apps/api/src/embed.ts`. A/B compartilham explicitamente apenas `http://localhost:4174`; `http://127.0.0.1:4174`, outras portas e subdomínios não são equivalentes. `inst_disabled` retorna 403 e IDs desconhecidos retornam 404, sempre sem fallback para outra empresa. O HTML tem `Cache-Control: no-store` e `frame-ancestors` específico; assets com hash têm cache longo, e loader/CSS exigem revalidação.

Se o host tiver CSP, adicione a origem real do produto a `script-src`, `frame-src` e **`style-src`** (ou às diretivas `*-src-elem`, caso definidas). O botão usa uma folha externa dentro de Shadow DOM, sem exigir `unsafe-inline`. As páginas de demonstração enviam essa política restritiva por cabeçalho HTTP. O servidor do widget usa nonce para a cor validada. Não configure `X-Frame-Options: DENY/SAMEORIGIN` no proxy do embed.

Em produção, configure instalações HTTPS explícitas no bootstrap via `buildApp({ installations: [...] })`; com `NODE_ENV=production`, nenhuma fixture local é habilitada automaticamente. Não publique as fixtures como configuração real. A prova em dois domínios HTTPS e a verificação em Safari/iOS real continuam pendentes.

### Validação

```bash
npm run check
npm test
npm run build
npm run sizes
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

Os testes E2E iniciam os dois servidores e exigem portas 3000 e 4174 livres. Se você já iniciou a API deste checkout, use `E2E_REUSE_SERVER=1 npm run test:e2e` para reaproveitá-la: os testes conferem primeiro que ela entrega o loader do build atual. Cobrem Chromium, Firefox e WebKit em 1440×900, 390×844 e 320×568, com redimensionamento, navegação, foco, isolamento, falhas e comparação da geometria/estilos do host. Screenshots, traces de falha, versões dos navegadores e medições de tarefas longas (quando suportadas) ficam em `test-results/`. Os tamanhos gzip de `npm run sizes` são medições do build; a API local não aplica compressão HTTP.

Estrutura adicionada:

```text
apps/loader/       TypeScript sem framework, script clássico + CSS isolado
apps/widget/       Interface do iframe, build independente com assets hash
apps/demo-host/    HTML/CSS/JS próprios e servidor na porta 4174
packages/contracts/ Tipos e validação do protocolo e da configuração pública
tests/e2e/         Prova local entre origens distintas
```

Resultados e limitações desta entrega: [verificação do snippet](docs/verificacao-snippet.md).
