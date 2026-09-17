# Desenvolvimento local

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Pré-requisitos

- Node.js 24.20.0, definido em `.nvmrc`;
- npm 11 ou superior.

Na raiz do repositório:

```bash
npm install
npm run dev
```

O comando gera contratos, loader e widget, depois inicia a API Fastify e o
painel Vite. Use <http://localhost:5173> para o painel e
<http://localhost:5173/chatbot> para o chat de desenvolvimento. A API responde
em <http://localhost:3000/api/health>.

## Modos de conhecimento e IA

Sem configuração adicional, `/api/chat` lê
`apps/api/knowledge/articles.json`, cria um índice textual em memória e retorna
uma resposta demonstrativa. Reinicie a API depois de alterar o arquivo.

Para usar a Groq, crie `apps/api/.env.local` a partir de
`apps/api/.env.example` e defina:

```dotenv
GROQ_API_KEY=sua_chave
GROQ_MODEL=openai/gpt-oss-20b
```

Para apontar a outro JSON local, use um caminho absoluto em `KNOWLEDGE_FILE`.
`KNOWLEDGE_COMPANY_ID` define a empresa do endpoint legado de desenvolvimento.

Com `DATABASE_URL`, a API passa a usar a recuperação híbrida do PostgreSQL e
também exige `EMBEDDINGS_URL`. O chat persistente e a demonstração completa
precisam do banco e do worker; veja [Demonstração](demonstracao.md).

## Fluxo de trabalho

Execute antes de entregar uma alteração:

```bash
npm run check
npm test
npm run build
```

Use as suítes de banco e navegador quando a mudança atingir persistência,
loader, widget ou fluxos completos. A [referência de comandos](../reference/comandos.md)
indica os pré-requisitos de cada suíte.

## Onde alterar

- interface administrativa: `apps/admin/src/`;
- rotas, banco e IA: `apps/api/src/`;
- processamento assíncrono: `apps/worker/src/`;
- integração com a página hospedeira: `apps/loader/src/`;
- interface incorporada: `apps/widget/src/`;
- tipos e validadores compartilhados: `packages/contracts/src/`.
