# Contratos compartilhados

Pacote TypeScript com tipos, schemas e validações usados por API, loader, widget
e painel.

- `src/index.ts`: configuração pública e protocolo `postMessage`;
- `src/chat.ts`: chat persistente;
- `src/support-chat.ts`: chat síncrono de desenvolvimento;
- `src/knowledge.ts`: gestão administrativa do conhecimento.

```bash
npm run build -w @support-hub/contracts
npm run check -w @support-hub/contracts
npm run test -w @support-hub/contracts
```

Alterações de contrato devem ser compiladas antes dos workspaces consumidores.
