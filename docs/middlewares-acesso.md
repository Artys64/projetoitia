# Middlewares de acesso

Os middlewares ficam em `apps/api/src/middlewares/`, separados das rotas e do SQL:

- `user-access.ts`: protege as rotas de atendimento com Bearer de visitante.
- `admin-access.ts`: protege as rotas administrativas com cookie de sessão e confere a origem das escritas.
- `access.ts`: tipos do contexto da requisição, leitura do Bearer, erros e verificações de perfil.

O registro usa hooks `onRequest`, antes da leitura do corpo, dentro dos escopos protegidos do Fastify ([documentação](https://fastify.dev/docs/latest/Reference/Hooks/)). `POST /api/widget/sessions` permanece público para iniciar atendimento; as demais rotas registradas no escopo interno de `widget-routes.ts` exigem sessão válida. As rotas registradas no escopo protegido de `admin-routes.ts` herdam a proteção administrativa. Rotas de entrada/login ficam fora desse escopo e precisam aplicar sua própria validação de credenciais e de origem.

## Identidade e empresa

`request.access` recebe uma identidade própria da requisição, resolvida pelo servidor:

- Usuário: `role: user`, empresa, sessão e instalação.
- Admin: `role: admin`, empresa, sessão e usuário administrativo.

Corpo, query e cabeçalhos de perfil/empresa não atribuem permissões. A credencial de visitante não é aceita como sessão administrativa, nem a administrativa como visitante. `GET /api/widget/session` e `GET /api/admin/session` informam o perfil e a empresa autorizados para a futura navegação do frontend. A API retorna erros JSON; o redirecionamento de páginas pertence ao frontend.

A migração `004_admin_access.sql` adiciona usuários administrativos, associações às empresas e sessões opacas. Cada sessão administrativa está vinculada a uma associação específica. A troca de empresa deverá validar a outra associação e emitir uma sessão para ela; alterar um `companyId` no navegador não troca a autorização. Expiração, revogação e estado ativo de usuário, associação e empresa são consultados a cada acesso. Só o hash da credencial fica no banco. Esta migração concede leitura das três tabelas com RLS; permissões adicionais, como revogação de sessão, pertencem às entregas que as utilizam. Ela não permite ao papel HTTP criar administradores ou conceder associações.

## Cookie e origem

O middleware espera `__Host-support_hub_admin` em produção e `support_hub_admin` em desenvolvimento. O contrato de emissão exige uma credencial aleatória de 32 bytes em base64url, com cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` em produção e sem `Domain`. Cookies duplicados ou fora do formato são recusados. O hash presente no contexto interno administrativo também é sensível e não deve ser enviado em respostas nem registrado em logs.

Configure `ADMIN_ORIGIN` com a origem exata do painel. Métodos que alteram estado exigem o cabeçalho `Origin` correspondente. Sem essa configuração, escritas administrativas são recusadas. HTTP só é aceito para localhost em desenvolvimento. Host e cabeçalhos de proxy não definem a origem confiável. A implantação do login deverá alinhar domínio, cookies e política de origem; habilitar origens cruzadas não faz parte desta entrega.

## Integração e verificação

As operações do widget continuam revalidando a sessão dentro das transações existentes. O middleware faz uma checagem inicial adicional e não mantém transações abertas durante processamento HTTP. Serviços editoriais também precisam revalidar a autorização na transação final de publicação; `request.access` não substitui essa checagem.

Este documento cobre os middlewares; login, emissão/recuperação de credenciais e telas são entregas separadas. As sessões administrativas destes testes são criadas somente no PostgreSQL temporário por fixtures com credencial administrativa. Para atualizar um ambiente, aplicar as migrações pelo procedimento operacional; nenhuma migração é executada automaticamente no início da API.

Verificação: `npm run check -w @support-hub/api`, `npm run test -w @support-hub/api` e `npm run test:db`. Os testes cobrem isolamento de escopos, credenciais trocadas, origem das escritas, revogação, expiração, associação, RLS e reutilização de conexão. Não fazem chamadas reais de IA.
