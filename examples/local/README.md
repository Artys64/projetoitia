# Widget no Mille local

O Mille usa `http://localhost:3000`. A API do widget usa `http://localhost:3100`.
Este exemplo reutiliza os artigos de teste da empresa `hml_a`, com uma instalação
local independente da instalação HTTPS de homologação.

Na raiz do Support Hub, com as credenciais existentes em `apps/api/.env.local`
e a chave Groq em `apps/api/.env` ou `apps/api/.env.local`:

```bash
docker compose --env-file .env.homologacao.db -f compose.homologacao.yaml up -d --wait
npm run build
npm run db -- migrate
NODE_ENV=development npm run db -- installation "$PWD/examples/local/instalacao-mille.json"
npm run db -- articles "$PWD/examples/homologacao/artigos-a.json"
npm run dev:widget
```

Em banco novo, execute `npm run db -- provision` após as migrações.
O comando `dev:widget` compila e inicia somente API e worker, sem painel, host de
demonstração nem observadores de arquivos. Após editar o widget, reinicie esse
comando e recarregue o site. Encerre com Ctrl+C. Não execute outra API na porta 3100.

No site hospedeiro:

```html
<script
  src="http://localhost:3100/loader.js"
  data-installation-id="inst_local_mille"
  defer
></script>
```

Em Next.js, use `next/script` com `strategy="afterInteractive"`. A URL local e o
ID local devem ser usados apenas em desenvolvimento. Abra exatamente
`http://localhost:3000`: outras portas e `127.0.0.1` não estão autorizados.

Verifique `http://localhost:3100/api/health`. Deve retornar JSON com `status: "ok"`.
Se houver `handshake_timeout`, confira o endereço do loader, o ID e a origem
cadastrada. Com `NODE_ENV=production`, origens HTTP locais são rejeitadas.
