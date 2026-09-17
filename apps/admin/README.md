# Painel administrativo

Aplicação React/Vite com login, gestão da base de conhecimento e chat local de
desenvolvimento.

## Estrutura

- `src/tela/`: páginas e composição de fluxos;
- `src/components/`: componentes reutilizáveis;
- `src/hooks/`: estado e efeitos de conversa;
- `src/services/`: clientes HTTP;
- `src/styles/`: estilos por área.

O backend resolve a empresa pela sessão administrativa. A interface não deve
enviar um ID de empresa para autorizar leituras ou escritas.

## Comandos

```bash
npm run dev -w @support-hub/admin
npm run check -w @support-hub/admin
npm run build -w @support-hub/admin
```

Veja [Administrar conhecimento](../../docs/guides/administrar-conhecimento.md).
