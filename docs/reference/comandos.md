# Referência de comandos

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

| Comando | Finalidade | Dependências adicionais |
| --- | --- | --- |
| `npm run dev` | Painel Vite e API de desenvolvimento | nenhuma |
| `npm run demo:visual` | Host e widget sem chat persistente | nenhuma |
| `npm run demo` | Demonstração completa | banco, embeddings e Groq |
| `npm run build` | Compilar todos os workspaces | nenhuma |
| `npm run build:embed` | Compilar contratos, loader e widget | nenhuma |
| `npm run check` | Tipagem de todo o monorepo | nenhuma |
| `npm test` | Testes unitários, contratos e qualidade | nenhuma |
| `npm run test:e2e` | Snippet em Chromium, Firefox e WebKit | navegadores Playwright |
| `npm run test:db` | Persistência e isolamento | PostgreSQL de teste |
| `npm run test:chat` | Fluxo persistente no navegador | stack completa |
| `npm run sizes` | Tamanhos gzip dos bundles | build atualizado |
| `npm run worker` | Worker em modo de desenvolvimento | banco, embeddings e Groq |
| `npm run knowledge:index` | Consumir fila de indexação | banco e embeddings |
| `npm run quality:corpus` | Inspecionar o corpus da Nora | nenhuma |

## CLI do banco

Todos os comandos abaixo usam `MIGRATION_DATABASE_URL`:

```bash
npm run db -- migrate
npm run db -- provision
npm run db -- installation arquivo.json
npm run db -- articles arquivo.json
npm run db -- admin-create empresa
npm run db -- admin-session empresa
npm run db -- metrics
npm run db -- knowledge-backfill
npm run db -- prune-rate-buckets
```

`admin-session` é compatibilidade para o login por token. Para novos acessos,
prefira `admin-create` com usuário e senha.
