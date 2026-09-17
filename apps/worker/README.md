# Worker

Processo separado que consome jobs de conversa do PostgreSQL e gera respostas
da Nora mesmo quando o navegador já foi fechado. A indexação de publicações usa
o processo distinto `npm run knowledge:index`.

Exige `DATABASE_URL`, `EMBEDDINGS_URL` e `GROQ_API_KEY`.

```bash
npm run dev -w @support-hub/worker
npm run check -w @support-hub/worker
npm run build -w @support-hub/worker
npm run start -w @support-hub/worker
```

O worker deve usar o papel limitado da aplicação e acesso privado ao serviço de
embeddings. Veja [RAG e Nora](../../docs/architecture/rag-e-nora.md).
