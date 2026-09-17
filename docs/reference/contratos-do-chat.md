# Contratos do chat

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Chat persistente do widget

Todas as rotas ficam sob `/api/widget`. Depois da criação da sessão, envie
`Authorization: Bearer <token>`. Criações e retries usam `Idempotency-Key`.

| Método e rota | Resultado |
| --- | --- |
| `POST /sessions` | Cria sessão para uma instalação. |
| `GET /session` | Retorna papel, empresa e instalação da sessão. |
| `DELETE /session` | Revoga a sessão. |
| `GET /conversations` | Lista conversas com cursor. |
| `POST /conversations` | Cria conversa. |
| `GET /conversations/:id/messages` | Lista mensagens após uma sequência. |
| `POST /conversations/:id/messages` | Aceita mensagem e retorna run com HTTP 202. |
| `POST /conversations/:id/ai-runs/:runId/retry` | Reenfileira falha elegível. |
| `GET /knowledge/:articleId?version=N` | Resolve uma fonte citada. |

Mensagens de entrada têm de 1 a 500 caracteres não vazios. A paginação aceita
até 50 conversas e 100 mensagens por chamada. Formatos completos ficam em
`packages/contracts/src/chat.ts`.

## Chat síncrono de desenvolvimento

`POST /api/chat` aceita `{ "message": "..." }` ou um histórico em
`{ "messages": [...] }` e retorna `{ "reply": "...", "suggestions": [] }`.
Essa rota existe apenas fora de produção e não substitui o contrato persistente.

## Administração

As rotas `/api/admin` usam cookie de sessão. Login aceita usuário/senha ou token
legado. As rotas protegidas permitem consultar sessão e criar, editar, publicar,
despublicar ou excluir conhecimento. Escritas exigem a origem configurada em
`ADMIN_ORIGIN`.
