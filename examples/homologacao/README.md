# Dados fictícios de homologação

Estes arquivos são exemplos para duas empresas de teste. Os portais e procedimentos descritos nos artigos são fictícios. As origens `https://host-a.example` e `https://host-b.example` são marcadores: substitua-as pelas origens HTTPS reais antes de importar as instalações. Use apenas protocolo e domínio (e porta, quando aplicável), sem caminho ou barra final. Cada empresa deve autorizar somente seu próprio site.

Na raiz do projeto, com o PostgreSQL iniciado e as migrações aplicadas:

```bash
nvm use
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js installation examples/homologacao/instalacao-a.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js installation examples/homologacao/instalacao-b.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js articles examples/homologacao/artigos-a.json
node --env-file=.env.homologacao.admin apps/api/dist/db/cli.js articles examples/homologacao/artigos-b.json
```

Esses comandos usam a credencial administrativa já configurada. Não exporte credenciais de outro ambiente: variáveis exportadas prevalecem sobre o arquivo de configuração. Para alterar um artigo já importado, incremente `version`.

Com a API escutando em `127.0.0.1:3100`, abra um terminal separado e execute:

```bash
cloudflared tunnel --url http://127.0.0.1:3100
```

O comando torna a API acessível pela internet enquanto o processo estiver ativo. Copie o endereço HTTPS retornado e use-o no lugar de `https://API_REAL.trycloudflare.com` nos snippets abaixo.

No site A:

```html
<script src="https://API_REAL.trycloudflare.com/loader.js" data-installation-id="inst_hml_a" defer></script>
```

No site B:

```html
<script src="https://API_REAL.trycloudflare.com/loader.js" data-installation-id="inst_hml_b" defer></script>
```

Se o site definir CSP, autorize a origem HTTPS da API em `script-src`, `style-src` e `frame-src`. Os sites A e B precisam ter origens HTTPS diferentes. As páginas atuais de `apps/demo-host` precisam de adaptação de snippet e CSP para este ambiente; executar seu servidor sem adaptação não conclui esta configuração.

Pergunte “Qual é o horário de atendimento?” em ambos os chats. A Aurora deve responder segunda a sexta, 9h às 18h; a Jardim e Casa deve responder terça a sábado, 10h às 16h. Pergunte também como acompanhar uma solicitação e compare com os artigos de cada empresa. Feche e reabra o chat e recarregue a página para verificar o histórico. Um snippet A instalado no site B deve ser bloqueado.

Confira o roteiro completo, incluindo inicialização da API e do worker, em [Homologação sem cartão](../../docs/homologacao-sem-cartao.md). Este preparo não significa que os dados já foram importados nem que houve validação HTTPS ou da resposta real da Nora.
