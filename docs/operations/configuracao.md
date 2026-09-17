# Configuração

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

Copie `apps/api/.env.example` para `apps/api/.env.local`. Esse arquivo não deve
ser versionado. A API e os comandos locais carregam `.env` e `.env.local` quando
indicado pelos scripts do pacote.

## Perfis

| Perfil | Configuração mínima |
| --- | --- |
| Desenvolvimento sem banco | nenhuma |
| Chat local com Groq | `GROQ_API_KEY` |
| API com PostgreSQL | `DATABASE_URL`, `EMBEDDINGS_URL` |
| Worker | `DATABASE_URL`, `EMBEDDINGS_URL`, `GROQ_API_KEY` |
| Migrações e importação | `MIGRATION_DATABASE_URL` |
| Provisionamento do papel de runtime | anterior + `APP_DATABASE_PASSWORD` |
| Cadastro administrativo | anterior + `ADMIN_USERNAME`, `ADMIN_PASSWORD` |

`DATABASE_URL` deve usar o papel limitado `support_hub_app`.
`MIGRATION_DATABASE_URL` usa o proprietário e deve ficar restrita a tarefas
administrativas. Nunca inverta essas credenciais.

Em produção, configure `NODE_ENV=production`, uma `ADMIN_ORIGIN` HTTPS exata e
`TRUST_PROXY_HOPS` de acordo com a quantidade real de proxies confiáveis. A API
recusa produção sem banco e não habilita as instalações fictícias nem `/api/chat`.

Consulte a [referência de variáveis](../reference/variaveis-de-ambiente.md) para
valores, consumidores e regras de segurança.
