# Mensagens e Nora persistentes

Implementação local de HTTP + consulta periódica. Ainda exige homologação HTTPS e decisões operacionais antes do piloto. Não oferece atendimento humano, streaming, identidade entre dispositivos nem gestão administrativa pelo painel.

## Executar com seu PostgreSQL

Use Node 24.20.0 (`nvm use`), `npm ci` e Docker. Banco PostgreSQL 18 com pgvector é obrigatório. A suíte de integração inicia um container isolado da imagem fixada em `pgvector/pgvector:0.8.6-pg18-trixie`; nunca a aponte para o banco operacional.

No arquivo local `apps/api/.env.local`, configure:

- `MIGRATION_DATABASE_URL`: conexão administrativa, com permissão de criar tabelas e papel de runtime.
- `APP_DATABASE_PASSWORD`: senha aleatória com no mínimo 20 caracteres para `support_hub_app`.
- `DATABASE_URL`: mesma conexão, com usuário `support_hub_app` e a senha acima; codifique caracteres especiais da senha na URL.
- `GROQ_API_KEY`: chave da Groq para o worker (e chatbot legado em desenvolvimento).
- `EMBEDDINGS_URL`: endpoint privado do serviço local, por exemplo `http://127.0.0.1:8090`.

Não versione esse arquivo. Nunca execute os testes contra um banco do piloto.

```bash
npm run db -- migrate
npm run db -- provision
npm run build
npm run dev
```

Prepare os pesos na revisão fixada, suba o serviço local e depois execute `npm run worker` em outro terminal:

```bash
hf download intfloat/multilingual-e5-small \
  --revision fd1525a9fd15316a2d503bf26ab031a61d056e98 \
  --local-dir models/multilingual-e5-small
docker compose --env-file .env.homologacao.db -f compose.homologacao.yaml up -d --wait
```

O worker de produção exige Groq e embeddings e nunca troca silenciosamente por respostas ou vetores simulados. Para testar o embed, inicie também `npm run start -w @support-hub/demo-host`.

## Cadastrar instalação e conhecimento

Crie um JSON de instalação, usando valores reais:

```json
{
  "installationId": "inst_cliente",
  "companyId": "cliente",
  "name": "Nome da empresa",
  "greeting": "Olá! Como podemos ajudar?",
  "color": "#284e78",
  "allowedOrigins": ["https://site-do-cliente.example"],
  "active": true
}
```

```bash
npm run db -- installation /caminho/instalacao.json
npm run db -- articles /caminho/artigos.json
```

O formato de artigos continua sendo o documentado no README, com `companyId` correspondente à instalação. Os artigos existentes em `apps/api/knowledge/articles.json` podem ser importados após cadastrar a empresa `support-hub`; nenhuma cópia automática entre empresas é feita. Versões são imutáveis: altere o conteúdo incrementando `version`. `status: "draft"` remove a publicação imediatamente. Importar apenas alguns artigos não exclui os demais. Instalações não podem mudar de empresa.

`npm run demo` carrega os arquivos de ambiente da API e exige banco migrado,
papel de runtime provisionado e chave Groq. O comando cadastra explicitamente
`inst_demo_a`/`company_a` e `inst_demo_b`/`company_b`, a instalação desativada de
teste e um artigo fictício de horário para cada empresa ativa, preservando o
histórico. Depois inicia API, worker e host. Não execute em produção.

Sem banco, use `npm run demo:visual` para a demonstração navegável que informa
que o chat está indisponível. Com banco, apenas instalações cadastradas são
servidas; as fixtures não são fallback. Produção exige banco e não registra `/api/chat`.

## Sessões, limites e recuperação

Credencial aleatória de 256 bits, somente hash no banco, expiração de 7 dias e revogação explícita. O iframe guarda a credencial em `localStorage`, com chave por instalação e origem do pai validada no handshake. O loader nunca recebe a credencial. Armazenamento bloqueado usa memória e exibe aviso. Sessão expirada pede uma nova sessão, sem acessar histórico antigo. Revogação encerra também a autorização de novas respostas pendentes.

Limites iniciais conservadores, a revisar antes de dados reais:

| Controle | Valor |
|---|---:|
| Emissão de sessão por IP | 30/hora |
| Requisições por credencial | 120/minuto |
| Conversas por sessão | 50 |
| Pergunta | 500 caracteres |
| Reservas diárias por sessão | 30 |
| Reservas diárias por empresa | 200, configurável em `tenants` |
| Gerações pendentes por empresa | 4, configurável em `tenants` |
| Geração ativa por conversa | 1 |
| Tentativas totais por execução | 3 |
| Lease do worker | 60 segundos |
| Timeout da Nora | 20 segundos |
| Histórico enviado ao modelo | 12 mensagens |

Reservas contam chamadas admitidas, incluindo novas tentativas e recuperação de lease; não são um teto monetário ou limite exato de tokens. Falhas não devolvem a reserva. Tokens efetivos ficam registrados na execução. É possível haver nova cobrança no provedor após crash; a resposta persistida é única.

API, worker e importador mantêm transações curtas. A indexação calcula embeddings fora do banco, persiste lotes de até 16 trechos com renovação de lease e usa uma transação final curta para ativar o conjunto completo. A busca combina full-text português e pgvector exato, sempre filtrados por empresa, publicação, conjunto e perfil dentro do SQL. Não existe leitura integral dos artigos nem índice completo em memória no caminho PostgreSQL. O importador aceita até 1.000 artigos por arquivo; a carga de referência com 10.000 artigos ainda precisa ser medida.

Uma mensagem confirmada, execução e job são gravados na mesma transação. A mesma chave de idempotência recupera uma confirmação perdida; um payload diferente gera 409. O widget conserva a chave de um envio não confirmado. Geração falhada mantém a pergunta, permite retry controlado e não executa loops automáticos de erro. Lease expirada pode ser recuperada por outro worker; token de lease e tentativa impedem publicação do worker antigo. Antes da resposta, instalação, sessão, conversa e versões publicadas são revalidadas.

## Geração e auditoria das respostas

Worker e chat de desenvolvimento com LLM usam `generateNoraResponse`. Cada tentativa faz somente a geração da Nora, com prazo máximo de 20 segundos e retries automáticos do SDK desativados. Resposta vazia, falha de busca, falha do provedor ou timeout bloqueiam a tentativa.

Aplique `npm run db -- migrate` antes de iniciar esta versão do worker. A migração aditiva `002_response_verification.sql` cria `ai_run_attempts`, com RLS por empresa e chave por execução/tentativa. Ela concede as permissões necessárias ao papel de runtime já existente; o provisionamento também inclui a nova tabela. Nenhuma tabela anterior é removida e os registros antigos não são reescritos.

Cada tentativa registra versão do prompt, modelo, uso reportado, duração, fontes recuperadas, estado final e modo efetivamente publicado. Perguntas e respostas não são armazenadas nessa auditoria. A linha é iniciada junto com a aquisição da lease. Uma conclusão tardia pode preencher apenas a auditoria da própria tentativa expirada, mantendo-a expirada; não altera a execução nem a tentativa mais nova. Crashes sem resultado conhecido deixam o uso desconhecido.

Após a geração fora da transação, a publicação revalida empresa, instalação, sessão, conversa, lease e todas as versões recuperadas. Expiração de sessão e lease também são conferidas por `clock_timestamp()` no `INSERT`, depois de eventuais esperas por locks. Mensagem final, auditoria e conclusão da execução são gravadas atomicamente.

Erros de geração preservam a pergunta e permitem a nova tentativa já oferecida pelo widget, dentro dos limites existentes. `source_changed` continua exigindo nova pergunta. O endpoint de mensagens expõe apenas estado/código de erro e mensagens publicadas; não expõe auditoria interna. Sem LLM, `/api/chat` identifica explicitamente a resposta como demonstração local sem avaliação de pertinência.

`npm run db -- metrics` preserva `counts`, `queue` e `reservations` e acrescenta `attempts` e `publications`. `counts.tokens` continua descrevendo o último resultado de cada execução. Para consumo incluindo retries e leases expiradas, use `attempts.known_tokens` junto com `unknown_usage_count`. A retenção da auditoria deve ser definida com a retenção das conversas antes de usar dados reais.

Os testes locais usam provedor simulado. Integração técnica aprovada não implica qualidade semântica aprovada com a Groq; veja o [plano de qualidade](plano-qualidade-respostas-nora.md).

## Render: configuração preparada, ainda não aplicada

Alternativa sem cartão: [homologação local com Quick Tunnel HTTPS](homologacao-sem-cartao.md). Use esse procedimento para sessões agendadas sem contratar os recursos pagos abaixo.

O `render.yaml` descreve API, worker e PostgreSQL em homologação separada, com deploy automático desligado. Região e recursos pagos são propostas para revisão. A sintaxe foi consultada na [referência oficial do Blueprint](https://render.com/docs/blueprint-spec).

1. Defina conta, orçamento e região; confira os recursos do Blueprint antes de aplicar. Crie o banco e obtenha seu endereço interno. Não publique configurações de exemplo como clientes reais.
2. Configure `APP_DATABASE_PASSWORD` e `DATABASE_URL` do papel `support_hub_app`. A API recebe a URL administrativa do banco apenas para o `preDeployCommand`, que executa migração com lock e checksum e provisiona o papel limitado. O worker recebe apenas a conexão de runtime e a chave Groq.
3. Suba a API primeiro e depois o worker com a mesma revisão. O worker pode falhar na primeira inicialização se partir antes da migração; reinicie-o após o predeploy. Em atualizações futuras, use migrações compatíveis com a versão anterior.
4. Cadastre instalações e artigos no shell administrativo da API; não há endpoint administrativo público. Restrinja o acesso à configuração/shell do serviço, pois contém a credencial de migração. Para maior separação operacional, remova essa credencial do serviço após bootstrap e migre por um job administrativo isolado.
5. Confira `/api/health` e execute `npm run db -- metrics`. API sem banco acessível devolve 503; o worker registra falhas de conexão e retoma a fila ao recuperar.
6. Cadastre dois sites HTTPS de teste e instale o snippet usando o domínio real da API. Verifique CSP, isolamento, envio, recarga e bloqueio de origem nos navegadores obrigatórios. A configuração do proxy confia em um salto; se houver outra topologia, ajuste `TRUST_PROXY_HOPS` após validar o endereço real do cliente.

O domínio `onrender.com` da API também pode servir loader e iframe. Em hosts com CSP, autorize esse domínio em `script-src`, `style-src` e `frame-src`. O iframe permite `connect-src 'self'`. Não altere `frame-ancestors` no proxy. O painel administrativo não é publicado por este Blueprint.

## Operação e pendências do piloto

`npm run db -- metrics` mostra estados, latência média, tokens, reservas e idade da fila por empresa. Logs não incluem perguntas, artigos, tokens de sessão nem credenciais do provedor. Agende `npm run db -- prune-rate-buckets` diariamente para remover contadores expirados. A retenção de mensagens, auditoria, sessões e idempotência não é automaticamente removida: deve ser definida antes de coletar dados reais.

Antes do piloto, ainda é necessário configurar alertas (fila parada, erros e latência), definir retenção/exclusão, responsável operacional, orçamento, RPO/RTO, ensaiar backup/restauração em banco separado e validar comportamento em Safari/iOS real e modo privado. Reiniciar o banco em teste não comprova restauração de backup. Não remover tabelas para rollback: volte a revisão do app apenas se o schema continuar compatível; mudanças de schema devem ter migração de correção.

## Verificações

```bash
npm run check
npm test
npm run test:db
npm run build
npm run sizes
npm run test:chat
npm run test:e2e
```

Os dois últimos comandos exigem navegadores Playwright instalados e portas 3000/4174 livres. `test:chat` cria PostgreSQL/pgvector temporário e usa provedor simulado; `test:e2e` verifica também a demonstração sem banco. Os testes unitários usam `--test-isolation=none` para que os casos TypeScript sejam de fato executados neste ambiente.

### Avaliar o provedor real separadamente

`node --env-file=apps/api/.env.local --import tsx scripts/evaluate-nora.mts` faz três chamadas de avaliação com perguntas sintéticas, consumindo a cota da Groq. O relatório fica em `test-results/groq-evaluation.json`. O comando mede resposta, fontes, buscas, etapas, latência e tokens; sucesso HTTP não significa aprovação de qualidade. Revise manualmente se cada orientação está de fato documentada. A avaliação de 14/09 identificou extrapolações mesmo após reforçar o prompt: a qualidade ainda é uma pendência do piloto.

### Reprodução do WebKit neste ambiente

Os binários de navegador foram baixados em `/tmp/support-hub-browsers`. As bibliotecas faltantes foram extraídas de pacotes Ubuntu para `/tmp/support-hub-webkit-libs` e ligadas aos diretórios `sys/lib` do WebKit em `/tmp`; nenhum pacote foi instalado no sistema. Após conferir com `ldd` que não restavam dependências ausentes, os testes usaram `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`, porque a verificação do Playwright procura pacotes instalados pelo sistema. Os testes do navegador foram executados normalmente.

Esses diretórios são temporários. Em outra máquina, prefira `npx playwright install --with-deps chromium firefox webkit`. A emulação de viewport não equivale a um teste em Safari/iOS real.
