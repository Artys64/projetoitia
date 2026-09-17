# Banco e migrações

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

O chat persistente usa PostgreSQL 18 com pgvector. O proprietário aplica
migrações e provisiona o papel limitado usado pela aplicação.

## Preparar

Defina `MIGRATION_DATABASE_URL`, `DATABASE_URL` e
`APP_DATABASE_PASSWORD` em `apps/api/.env.local`, depois execute:

```bash
npm run db -- migrate
npm run db -- provision
```

Migrações são aditivas e podem ser reaplicadas. A API verifica na inicialização
que `DATABASE_URL` não pertence a um papel com `SUPERUSER` ou `BYPASSRLS`.

## Importar configuração

```bash
npm run db -- installation caminho/instalacao.json
npm run db -- articles caminho/artigos.json
```

Os exemplos ficam em `examples/local/` e `examples/homologacao/`. Em produção,
origens HTTP são rejeitadas.

Para conteúdo publicado antes das migrações vetoriais:

```bash
npm run db -- knowledge-backfill
npm run knowledge:index
```

Mantenha o indexador ativo até a fila esvaziar. Outros comandos administrativos
estão na [referência de comandos](../reference/comandos.md).

## Embeddings locais

Baixe o modelo conforme `services/embeddings-local/README.md` e inicie o serviço
do Compose. A porta 8090 é privada e deve ficar acessível somente à API e ao
worker.

## Proteção dos dados

Não execute testes de banco contra uma base que contenha dados a preservar. O
volume da homologação não substitui backup. Antes de um piloto, defina e teste
backup, restauração e retenção; esse item permanece no
[roadmap](../project/roadmap.md).
