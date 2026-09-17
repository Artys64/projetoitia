# Support Hub

Central de suporte instalável por snippet, com painel administrativo, histórico
persistente e respostas da Nora fundamentadas na base de conhecimento de cada
empresa.

O monorepo usa TypeScript, React, Fastify e PostgreSQL com pgvector. A geração da
Nora roda em um worker e a indexação possui um processo próprio. Loader e widget
têm builds independentes para que a instalação não dependa da aplicação
hospedeira.

## Início rápido

Requisitos: Node.js 24.20.0 (veja `.nvmrc`) e npm 11 ou superior.

```bash
npm install
npm run dev
```

- Painel: <http://localhost:5173>
- Chat de desenvolvimento: <http://localhost:5173/chatbot>
- API: <http://localhost:3000>
- Health check: <http://localhost:3000/api/health>

Esse modo não exige PostgreSQL. Sem `GROQ_API_KEY`, o chat usa a busca textual
local e informa que a resposta é demonstrativa. Veja o
[guia de desenvolvimento](docs/getting-started/desenvolvimento-local.md) para
configurar IA, banco e serviço de embeddings.

## Demonstração completa

Com PostgreSQL, embeddings e Groq configurados:

```bash
npm run demo
```

O comando compila o projeto, prepara duas empresas fictícias e inicia API,
worker e host externo. O painel administrativo fica em
<http://localhost:4174/admin>. Para conferir somente layout e integração do
snippet, use `npm run demo:visual`.

Siga o [guia da demonstração](docs/getting-started/demonstracao.md) para preparar
as dependências e credenciais.

## Componentes

```text
apps/admin/          Painel React e chat de desenvolvimento
apps/api/            API Fastify, autenticação, persistência e RAG
apps/worker/         Geração assíncrona das respostas da Nora
apps/loader/         Script público que injeta e controla o widget
apps/widget/         Interface isolada em iframe
apps/demo-host/      Sites externos usados nas demonstrações
packages/contracts/  Contratos compartilhados entre os componentes
services/            Serviços auxiliares, como embeddings locais
tests/               Verificações E2E e corpus de qualidade
```

A [visão geral da arquitetura](docs/architecture/visao-geral.md) explica o fluxo
entre esses componentes.

## Comandos principais

```bash
npm run dev          # painel e API sem infraestrutura obrigatória
npm run demo         # demonstração persistente completa
npm run demo:visual  # demonstração visual sem banco nem IA
npm run check        # tipagem e verificações estáticas
npm test             # testes unitários e de contratos
npm run build        # builds de produção
npm run test:e2e     # integração do snippet em navegadores
npm run test:db      # testes que exigem PostgreSQL
npm run test:chat    # fluxo persistente no navegador
```

A lista completa, com pré-requisitos, está na
[referência de comandos](docs/reference/comandos.md).

## Documentação

A documentação começa em [docs/index.md](docs/index.md). Atalhos:

- [desenvolvimento local](docs/getting-started/desenvolvimento-local.md);
- [instalação do widget](docs/guides/instalar-widget.md);
- [administração da base de conhecimento](docs/guides/administrar-conhecimento.md);
- [configuração e variáveis de ambiente](docs/operations/configuracao.md);
- [banco e migrações](docs/operations/banco-e-migracoes.md);
- [roadmap e pendências](docs/project/roadmap.md).

Os planos antigos e relatórios de verificações anteriores permanecem em
`docs/archive/` como registro histórico. Eles não substituem os guias vigentes.
