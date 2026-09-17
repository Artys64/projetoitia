> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# Homologação sem cartão

Estratégia preparada em 14/09/2026: API, worker e PostgreSQL em uma máquina disponível, com acesso HTTPS temporário por Cloudflare Quick Tunnel. Não exige contratar hospedagem nem comprar domínio. Depende de a máquina permanecer ligada e conectada durante a sessão. O Render fica como alternativa futura; não aplique o Blueprint pago para seguir este procedimento.

O objetivo é homologação funcional agendada com dados fictícios. Esta preparação não significa que o túnel foi aberto ou que a homologação foi aprovada.

## Arquitetura e limites

| Componente | Execução |
|---|---|
| PostgreSQL 18 + pgvector 0.8.6 | Docker local, volume persistente exclusivo e porta 55432 somente em loopback |
| Embeddings E5 | Serviço Docker offline, pesos fixados e porta 8090 somente em loopback |
| API, loader e iframe | Build local, modo production, porta 3100 somente em loopback |
| Worker da Nora | Processo local separado, mesma revisão da API |
| Acesso externo à API | Quick Tunnel HTTPS apontando para 127.0.0.1:3100 |
| Sites de teste | Duas origens HTTPS controladas, cada uma com instalação própria |
| IA | Chave Groq já disponível, respeitando a cota e o plano dessa conta |

O [Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) é gratuito, dispensa conta, gera um subdomínio aleatório e não garante disponibilidade. Seu limite é de 200 requisições simultâneas e não há suporte a SSE. O widget atual usa consulta periódica HTTP, portanto não depende de SSE. Valide o funcionamento real pelo túnel antes de compartilhar a sessão.

O endereço pode mudar ao reiniciar o túnel. Quando mudar o domínio da API, atualize snippet e CSP nos hosts; o armazenamento do iframe muda de origem, então a sessão antiga pode deixar de ser acessível pelo navegador mesmo com histórico preservado no banco. Quando mudar a origem de um host, atualize também allowedOrigins e reimporte a instalação. Testes de retomada devem manter os mesmos domínios durante a rodada.

Não há cobrança de hospedagem nessa estratégia. Energia, internet e eventuais cobranças da conta Groq continuam sendo independentes. A homologação não inclui disponibilidade 24 horas, aprovação de qualidade da Nora ou validação operacional de produção.

## 1. Preparar ferramentas e configurações

Na raiz do repositório, use a versão Node de `.nvmrc`, dependências instaladas, Docker Engine com Compose e `cloudflared`. Instale o túnel pelas [instruções oficiais](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). No ambiente inspecionado, o comando Docker Compose existe; `cloudflared` ainda não foi encontrado. A execução do daemon Docker ainda precisa ser verificada.

```bash
nvm use
npm ci
docker compose version
cloudflared --version
```

Crie quatro arquivos na raiz. Todos os nomes abaixo são ignorados pelo Git. Preencha senhas diferentes, aleatórias, com pelo menos 20 caracteres; preferir valores hexadecimais evita caracteres especiais nas URLs. Não use literalmente os marcadores abaixo. Não exporte credenciais de outro ambiente no terminal: variáveis já exportadas prevalecem sobre `--env-file` do Node.

`.env.homologacao.db`:

```dotenv
POSTGRES_PASSWORD=SUBSTITUIR_SENHA_ADMIN
```

`.env.homologacao.admin`:

```dotenv
NODE_ENV=production
MIGRATION_DATABASE_URL=postgresql://support_hub_owner:SUBSTITUIR_SENHA_ADMIN@127.0.0.1:55432/support_hub_homologacao
APP_DATABASE_PASSWORD=SUBSTITUIR_SENHA_RUNTIME
```

`.env.homologacao.api`:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
TRUST_PROXY_HOPS=1
DATABASE_URL=postgresql://support_hub_app:SUBSTITUIR_SENHA_RUNTIME@127.0.0.1:55432/support_hub_homologacao
```

`.env.homologacao.worker`:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://support_hub_app:SUBSTITUIR_SENHA_RUNTIME@127.0.0.1:55432/support_hub_homologacao
EMBEDDINGS_URL=http://127.0.0.1:8090
GROQ_API_KEY=SUBSTITUIR_CHAVE_GROQ
GROQ_MODEL=openai/gpt-oss-20b
```

```bash
chmod 600 .env.homologacao.db .env.homologacao.admin .env.homologacao.api .env.homologacao.worker
```

A configuração de proxy pressupõe `cloudflared` na mesma máquina e API acessível apenas por loopback. Confira o IP registrado por requisições externas e o limite por IP; não copie essa confiança para outra topologia sem validar os proxies envolvidos.

## 2. Subir banco e preparar aplicação

```bash
hf download intfloat/multilingual-e5-small \
  --revision fd1525a9fd15316a2d503bf26ab031a61d056e98 \
  --local-dir models/multilingual-e5-small
docker compose --env-file .env.homologacao.db -f compose.homologacao.yaml up -d --wait
npm run build
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js migrate
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js provision
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js knowledge-backfill
```

O [Compose](../../../compose.homologacao.yaml) fixa PostgreSQL/pgvector e monta os pesos E5 somente para leitura. O serviço de embeddings opera offline e não deve ser exposto. Reutilizar o volume preserva o banco. Alterar `POSTGRES_PASSWORD` no arquivo não altera a senha de um banco já inicializado.

Em terminais separados, a partir da raiz:

```bash
node --env-file=.env.homologacao.api apps/api/dist/server.js
```

```bash
node --env-file=.env.homologacao.worker apps/worker/dist/index.js
```

Esses comandos carregam apenas a configuração específica de cada processo. API sem credencial administrativa e sem chave Groq; worker sem credencial administrativa. Não use `npm run dev` para o serviço exposto pelo túnel: o modo production mantém `/api/chat` legado desabilitado e exige banco e instalações cadastradas.

```bash
curl --fail http://127.0.0.1:3100/api/health
```

## 3. Abrir HTTPS e cadastrar os hosts

Em outro terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:3100
```

Copie a URL HTTPS exibida. Este comando torna a API acessível pela internet durante sua execução. Não aponte o túnel para o banco nem para um servidor de arquivos na raiz do repositório. Se houver uma configuração existente de cloudflared incompatível com Quick Tunnels, siga a orientação oficial sem sobrescrever a configuração de outros túneis.

Use duas páginas de teste sob seu controle, em **origens HTTPS diferentes**. Duas rotas no mesmo domínio não comprovam o isolamento entre origens. Se ainda não houver sites, a preparação das duas páginas pode ser feita separadamente com servidores locais e um Quick Tunnel para cada host. Os arquivos atuais de `apps/demo-host` apontam para localhost e exigem adaptar URL do snippet e CSP antes de usar por HTTPS; apenas abrir um túnel para eles não é suficiente.

Crie um JSON por instalação e um arquivo de artigos fictícios por empresa, conforme o [guia de cadastro](operacao-chat-persistente.md#cadastrar-instalação-e-conhecimento). Cada instalação deve autorizar somente a origem HTTPS exata do seu host. Exemplo de instalação A:

```json
{
  "installationId": "inst_hml_a",
  "companyId": "hml_a",
  "name": "Empresa A de homologação",
  "greeting": "Olá! Este é um ambiente de testes.",
  "color": "#284e78",
  "allowedOrigins": ["https://HOST_A_REAL"],
  "active": true
}
```

Para B, use `inst_hml_b`, `hml_b`, outro nome e apenas a origem do host B. Os artigos devem ter o companyId correspondente; não importe a base de outra empresa como se fosse conteúdo validado desses clientes.

```bash
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js installation /caminho/instalacao-a.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js installation /caminho/instalacao-b.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js articles /caminho/artigos-a.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js articles /caminho/artigos-b.json
```

No host A, substitua o domínio do exemplo pela URL gerada para a API:

```html
<script src="https://API_REAL.trycloudflare.com/loader.js"
  data-installation-id="inst_hml_a" defer></script>
```

No host B, use a mesma API e `inst_hml_b`. Autorize o domínio da API nas diretivas `script-src`, `style-src` e `frame-src` da CSP de cada host. Preserve o `frame-ancestors` enviado pela API.

## 4. Critérios da rodada

- Health check acessível pela URL HTTPS da API; `/api/chat` legado retorna 404.
- Loader e iframe carregam sem bloqueio de CSP nem conteúdo misto.
- Empresas A/B apresentam configuração, artigos e conversas isolados.
- Snippet A no host B é bloqueado; origem não cadastrada não abre o widget.
- Envio, resposta real da Nora, fechamento, recarga e histórico funcionam.
- Falha/reinício do worker permitem recuperação sem resposta duplicada.
- Safari/iOS real, modo privado e armazenamento bloqueado são registrados separadamente.
- Métricas e logs permitem identificar fila parada, erros e consumo; confira também IP real do cliente.
- A qualidade da resposta é avaliada contra os artigos. Transporte funcionando não aprova a Nora.

```bash
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js metrics
```

As suítes automatizadas existentes continuam usando seus bancos temporários. Nunca aponte testes destrutivos para este banco. Execute as verificações do [guia de operação](operacao-chat-persistente.md#verificações) quando houver alterações de código; esta mudança de estratégia não substitui a validação HTTPS manual.

## 5. Encerrar e retomar

Encerre os túneis, a API e o worker com Ctrl+C. Pare o banco preservando seu volume:

```bash
docker compose --env-file .env.homologacao.db -f compose.homologacao.yaml stop
```

Para retomar, repita `up -d --wait`, inicie API/worker e reabra os túneis. Atualize os domínios onde necessário. Não use `down -v`: ele apagaria o volume desta homologação. O volume persistente não substitui backup; restauração e política de retenção continuam pendentes antes de um piloto com dados reais.

Se a homologação precisar permanecer acessível com esta máquina desligada, será necessário usar outra máquina sempre ligada ou rever a hospedagem. Essa exigência não é atendida pelo túnel local.
