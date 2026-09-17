# Variáveis de ambiente

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

| Variável | Consumidor | Uso |
| --- | --- | --- |
| `HOST` | API | Interface de rede; padrão `0.0.0.0`. |
| `PORT` | API | Porta HTTP; padrão `3000`. |
| `LOG_LEVEL` | execução | Nível de log configurado pelo ambiente. |
| `NODE_ENV` | API/CLI | Ativa regras de produção e proíbe fixtures HTTP. |
| `GROQ_API_KEY` | worker/API local | Credencial do provedor; segredo. |
| `GROQ_MODEL` | worker/API local | Modelo; padrão `openai/gpt-oss-20b`. |
| `EMBEDDINGS_URL` | API/worker/indexador | Endpoint privado do serviço de embeddings. |
| `KNOWLEDGE_FILE` | API sem banco | Caminho absoluto para o JSON local. |
| `KNOWLEDGE_COMPANY_ID` | API sem banco | Empresa fixa do `/api/chat`; padrão `support-hub`. |
| `DATABASE_URL` | API/worker/indexador | PostgreSQL com papel de runtime limitado. |
| `MIGRATION_DATABASE_URL` | CLI/pre-deploy | PostgreSQL com proprietário; segredo administrativo. |
| `APP_DATABASE_PASSWORD` | `db provision` | Senha do papel `support_hub_app`. |
| `TRUST_PROXY_HOPS` | API | Proxies confiáveis, inteiro de 0 a 3. |
| `ADMIN_ORIGIN` | API | Origem exata autorizada para o painel. |
| `ADMIN_USERNAME` | `db admin-create` | Usuário usado somente no cadastro. |
| `ADMIN_PASSWORD` | `db admin-create` | Senha de 12–256 caracteres usada somente no cadastro. |

Não exponha segredos com prefixos de frontend, no snippet ou na configuração
pública do iframe. Em produção, `ADMIN_ORIGIN` e origens de instalação precisam
usar HTTPS.
