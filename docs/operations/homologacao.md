# Homologação

Status: preparada, ainda não aprovada para piloto  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

A homologação pode rodar em uma máquina local com PostgreSQL e embeddings no
Docker, enquanto API e worker rodam no host. Cloudflare Quick Tunnels podem
fornecer HTTPS temporário sem contratação de hospedagem; os endereços mudam a
cada reinicialização.

## Preparar infraestrutura

1. Baixe o modelo indicado em `services/embeddings-local/README.md`.
2. Configure os arquivos `.env.homologacao.*` locais.
3. Inicie banco e embeddings:

```bash
docker compose --env-file .env.homologacao.db \
  -f compose.homologacao.yaml up -d --wait
npm run db -- migrate
npm run db -- provision
```

4. Importe instalações e artigos fictícios de `examples/homologacao/`.
5. Enfileire e processe a indexação:

```bash
node --env-file=.env.homologacao.admin \
  apps/api/dist/db/cli.js knowledge-backfill
node --env-file=.env.homologacao.worker \
  apps/api/dist/db/knowledge-cli.js
```

6. Inicie a API em um terminal:

```bash
node --env-file=.env.homologacao.api apps/api/dist/server.js
```

Inicie o worker em outro terminal:

```bash
node --env-file=.env.homologacao.worker apps/worker/dist/index.js
```

7. Crie túneis separados para produto e páginas hospedeiras.

Use `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3100` e
`TRUST_PROXY_HOPS=1` no ambiente da API quando o único proxy for o `cloudflared`
local. Defina também `ADMIN_ORIGIN` com a origem HTTPS exata que hospeda o
painel. Reavalie `TRUST_PROXY_HOPS` se a topologia mudar.

## Critérios mínimos

- duas páginas sob origens HTTPS distintas;
- cada instalação aceita somente sua origem exata;
- perguntas equivalentes usam somente os artigos da empresa correta;
- recarga recupera o histórico do visitante;
- fechar o iframe não cancela uma resposta em andamento;
- instalação inexistente, desativada e origem incorreta falham sem fallback;
- login, edição, publicação, despublicação e logout funcionam no painel;
- nenhum token ou chave aparece no host, HTML público ou logs.

Não use `docker compose down -v` se precisar preservar o volume. Para o roteiro
histórico mais detalhado, consulte o
[documento arquivado](../archive/plans/homologacao-sem-cartao.md).
