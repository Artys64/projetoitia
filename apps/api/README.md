# API

Backend Fastify responsável por recursos do embed, sessões, conversas,
administração, persistência e recuperação de conhecimento.

## Estrutura

- `src/embed.ts`: loader, assets e HTML do iframe;
- `src/widget-routes.ts`: API do chat persistente;
- `src/admin-routes.ts`: login e gestão do conhecimento;
- `src/db/`: migrações, stores e CLI administrativa;
- `src/ia/`: Nora, busca, embeddings, prompts e verificação;
- `src/middlewares/`: identidade e autorização.

## Comandos

```bash
npm run dev -w @support-hub/api
npm run check -w @support-hub/api
npm run test -w @support-hub/api
npm run build -w @support-hub/api
```

Configuração: [documentação operacional](../../docs/operations/configuracao.md).
