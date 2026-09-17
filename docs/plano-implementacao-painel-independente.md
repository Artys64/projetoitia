# Plano de implementação: painel independente e multiempresa

Status: proposto, não implementado  
Data: 17/09/2026  
Origem: [problema e requisitos](problem-statement-painel-independente.md)

## Objetivo e escopo

Permitir que uma empresa se cadastre, entre no painel, configure sua instalação,
copie o snippet e publique conhecimento sem intervenção técnica por cliente.
Painel, API, banco e worker serão operados centralmente pelo Support Hub.

Este plano considera o código presente no workspace, incluindo as alterações
locais de login por senha e documentação. Antes de implementar, consolidar essa
base sem sobrescrever trabalho existente.

A primeira versão inclui onboarding público com verificação de e-mail,
recuperação de acesso, convites, permissões, instalações, origens, marca,
saudação, limites e desativação da empresa. Cobrança, SSO, domínio personalizado
por cliente, instalação dedicada e alternância entre empresas pela mesma conta
ficam para evoluções posteriores. API em outra origem é uma extensão opcional;
não é necessária para entregar a arquitetura preferida.

## Base existente e lacunas verificadas

| Área | Situação no código | Trabalho necessário |
| --- | --- | --- |
| Painel | `apps/admin/src/App.tsx` direciona para conhecimento ou chatbot | Navegação, sessão compartilhada e páginas de onboarding/configuração |
| Cliente HTTP | `services/knowledge.ts` usa `/api/admin` e cookie `same-origin` | Extrair cliente administrativo reutilizável |
| Login | Senha com scrypt, cookie HttpOnly, Secure em produção, expiração, revogação e limite por IP | Recuperação, e-mail verificado, convites e proteção dos novos fluxos |
| Identidade | `admin_credentials` vincula username globalmente único a usuário e tenant | Preservar logins existentes e adicionar e-mail verificado; uma conta por empresa nesta entrega |
| Autorização | Sessão resolve a empresa; `role: 'admin'` é fixo | Permissão por vínculo, revalidada nas operações |
| Provisionamento | CLI cria instalação e conta; runtime não possui todos os privilégios necessários | Operação atômica com privilégios restritos para cadastro público |
| Instalações | Banco e lookup público existem; não há CRUD administrativo | API, políticas, interface e snippet |
| Limites | Tenant já possui limites diário e de concorrência, usados pelo chat | Consulta e edição dentro de tetos definidos pela plataforma |
| Indexação | `apps/worker/src/index.ts` já executa `indexer.tick()` e `worker.tick()` | Validar implantação, processamento e eventual contenção entre filas |
| Deploy | Há Compose de homologação e `render.yaml` | Completar topologia de produção, embeddings, proxy, backup e validação |

Referências principais: `apps/api/src/admin-routes.ts`,
`apps/api/src/db/admin-sessions.ts`, `apps/api/src/db/admin.ts`, migrações
`004_admin_access.sql` e `012_admin_password_login.sql`.

## Decisões de arquitetura

1. **Mesma origem pública:** servir o build do painel em
   `https://painel.seudominio.com` e encaminhar `/api/*` à API por proxy.
   Serviços podem estar em processos distintos sem expor essa separação ao navegador.
2. **Widget centralizado:** publicar os assets e `/embed/:installationId`
   em uma origem estável do produto. Preservar as URLs que o loader deriva do
   próprio `src`; não gerar snippets que apontem para uma origem sem esses recursos.
3. **Tenant da sessão:** rejeitar campos de tenant em operações administrativas
   comuns. IDs de recursos recebidos continuam sujeitos à autorização e ao RLS.
4. **Cadastro como exceção controlada:** antes da primeira sessão, a empresa é
   criada por uma operação específica que gera o tenant no servidor. Não aceitar
   um tenant arbitrário como autorização para criar contas ou vínculos.
5. **Identidade compatível:** manter username/senha existentes; novos cadastros
   usam e-mail como login. Nesta versão, um e-mail corresponde a uma conta de uma
   empresa; convites para contas de outra empresa recebem orientação explícita.
   A evolução para identidade compartilhada exigirá desacoplar credencial e tenant.
6. **Papéis por vínculo:** proprietário gerencia empresa e acessos;
   administrador gerencia instalações e conhecimento; editor gerencia conhecimento.
   Separar esse papel do discriminador técnico `role: 'admin'` usado no acesso atual.
7. **Sem exclusão física no painel:** desativar empresa, instalação ou vínculo,
   preservando dados. Reativação de empresa será operação de suporte autenticada,
   pois sessões do tenant desativado deixam de funcionar.

## Etapa 1 — Contratos, identidade e fronteiras de acesso

Entregas:

- Definir schemas e respostas em `packages/contracts/src/admin.ts` e exportá-los
  por `index.ts`: sessão, empresa, instalação, convite e onboarding.
- Criar novas migrações incrementais depois da última versão existente na
  implementação; não alterar migrações já aplicadas.
- Adicionar papel a `admin_memberships`, e-mail e estado de verificação à
  identidade, tokens de cadastro/convite/recuperação, auditoria e fila de e-mails.
  Tokens terão hash, finalidade, expiração, consumo e vínculo aplicável.
- Definir backfill para contas existentes: manter login funcional, indicar
  proprietário inicial por regra determinística e documentar exceções com
  múltiplos usuários. Não considerar e-mails legados verificados automaticamente.
- Criar checagem de permissões reutilizável; revalidar papel, vínculo, sessão e
  empresa dentro da transação de escrita, seguindo `sessions.authorized()`.
- Revisar grants e políticas de usuários, vínculos, sessões, credenciais,
  tenants e instalações. O lookup público de instalação deve continuar funcionando
  sem abrir listagem administrativa global ou expor credenciais.
- Implementar provisionamento por função de banco com privilégios mínimos,
  entrada restrita e transação única. Caso use `SECURITY DEFINER`, fixar
  `search_path`, revogar execução pública, limitar grants e testar a função
  diretamente com o papel runtime. Nunca colocar `MIGRATION_DATABASE_URL` na API.
- Operações pré-login de token e senha precisam de interfaces igualmente
  restritas; não conceder leitura global de tokens ou atualização irrestrita
  de credenciais ao runtime.

Aceite: migrações funcionam em banco vazio e banco existente; usuário runtime
continua sem SUPERUSER/BYPASSRLS; chamadas fora do escopo autorizado falham,
inclusive por SQL direto com esse papel.

## Etapa 2 — Cadastro e provisionamento autônomo

Fluxo: informar empresa, e-mail e senha → verificar e-mail → provisionar empresa
e proprietário → abrir painel → configurar primeira instalação.

Entregas:

- Rotas propostas: `POST /api/admin/signup` e
  `POST /api/admin/signup/verify`. A confirmação consome o token por POST;
  abrir um link de e-mail não deve, sozinho, consumir o token.
- Validar e normalizar entradas; aplicar limites por IP e destinatário,
  respostas sem enumeração de contas e expiração das solicitações pendentes.
- Na confirmação, criar tenant, usuário, credencial, vínculo de proprietário,
  configuração de recuperação de conhecimento e sessão em uma transação.
  IDs são gerados no backend. Não criar instalação ativa antes de configurar origens.
- Tratar concorrência e repetição com unicidade e consumo atômico: duas
  confirmações não podem criar empresas duplicadas nem deixar empresa sem dono.
- Implementar adaptador de e-mail transacional e fila persistente com retry;
  falha no envio permite reenvio controlado sem repetir provisionamento.
- Adicionar páginas de cadastro, confirmação, reenvio e estado inicial vazio.

Aceite: uma pessoa conclui o cadastro e acessa sua empresa sem CLI; token
expirado/reutilizado falha; falhas intermediárias não deixam registros parciais.

## Etapa 3 — Instalações, domínios e configuração da empresa

Rotas propostas, todas sob `/api/admin` e autorizadas pela sessão:

| Operação | Rota | Permissão |
| --- | --- | --- |
| Consultar empresa e limites | `GET /company` | Todos os membros |
| Editar empresa e limites permitidos | `PATCH /company` | Proprietário |
| Desativar empresa | `POST /company/deactivate` | Proprietário com reautenticação |
| Listar/criar instalações | `GET/POST /installations` | Administrador ou proprietário |
| Editar instalação, origens e estado | `PATCH /installations/:id` | Administrador ou proprietário |
| Obter snippet | `GET /installations/:id/snippet` | Administrador ou proprietário |

Entregas:

- Store administrativo próprio, sem chamar diretamente o importador privilegiado
  do CLI. Reutilizar validadores e contratos existentes quando aplicável.
- Configurar nome, cor, saudação e origens exatas. Exigir HTTPS em produção,
  rejeitar curingas, credenciais na URL, caminhos e origens inválidas;
  permitir HTTP local apenas em desenvolvimento.
- Gerar snippet a partir da origem pública configurada no servidor e do ID da
  instalação. Não incluir senha, token administrativo, segredo ou chave de IA.
- Expor os limites existentes sem permitir que clientes ultrapassem os tetos
  da plataforma. Alterações de teto permanecem uma operação administrativa interna.
- Bloquear acesso administrativo e novas operações do widget ao desativar a
  empresa. Definir e testar cancelamento de jobs pendentes e bloqueio de novas
  publicações/resultados de jobs em execução após a desativação.
- Ao remover uma origem, revalidar requisições futuras de sessões do widget já
  abertas; revisar também caches e CSP do iframe para não manter autorização antiga.
- Registrar auditoria de mudanças de limites, origens, permissões e desativação.

Aceite: o cliente cria uma instalação, personaliza o widget, copia o snippet e
usa-o em origem autorizada. Origem removida, instalação inativa e recursos de
outra empresa são bloqueados, inclusive quando o ID é conhecido.

## Etapa 4 — Convites, recuperação e ciclo de vida de acesso

Entregas:

- Rotas de solicitar/confirmar recuperação de senha e de criar/listar/revogar
  convites; aceite público vinculado ao token e ao e-mail convidado.
- Convites com papel permitido, prazo, reenvio e consumo único. Aceitar convite
  não pode alterar silenciosamente o vínculo de uma conta com outra empresa.
- Tela de membros para proprietário, permitindo mudar papel e remover acesso.
  Impedir remoção ou rebaixamento do último proprietário, inclusive sob concorrência.
- Recuperação com resposta genérica, token de uso único e revogação das sessões
  anteriores após troca de senha. Usuários legados sem e-mail verificado precisam
  cadastrá-lo no painel antes de usar recuperação por e-mail.
- Revogar sessões ao remover vínculo e revalidar permissões após mudança de papel.
- Preservar cookies seguros, verificação exata de `Origin` e expiração atuais;
  exigir `ADMIN_ORIGIN` na inicialização de produção. Restringir login por token
  legado a uso operacional explícito, sem expô-lo como fluxo público do produto.
- Nunca registrar senhas ou tokens em logs; limpar parâmetros sensíveis da URL
  após captura no frontend e aplicar política de referrer às páginas de token.

Aceite: proprietário convida editor, editor publica conhecimento mas não gerencia
acessos, remoção interrompe acesso e recuperação invalida sessões anteriores.

## Etapa 5 — Experiência integrada do painel

Entregas:

- Extrair cliente HTTP de `services/knowledge.ts` para `services/admin-api.ts`,
  mantendo URLs relativas e cookies na mesma origem.
- Separar login e estado de sessão da página de conhecimento; implementar
  layout autenticado, navegação e páginas de empresa, instalações e membros.
- Tratar sessão expirada, acesso removido, validação, carregamento e falhas de
  rede sem apresentar dados da sessão anterior. Ocultar ações sem permissão,
  mantendo a autorização obrigatória no backend.
- Exibir checklist inicial: configurar instalação → autorizar domínio → copiar
  snippet → publicar primeiro artigo → testar atendimento.
- Preservar comportamento atual de conhecimento e validar navegação por URL
  direta, recarga, teclado e dispositivos móveis.

Aceite: o fluxo inteiro pode ser concluído pelo navegador; recarregar uma rota
interna não produz 404; logout elimina dados administrativos da interface.

## Etapa 6 — Implantação e operação

Entregas:

- Configurar proxy HTTPS para painel e `/api`, fallback SPA apenas nas rotas do
  frontend e entrega correta dos assets e endpoints do widget. Não aplicar
  bloqueio global de iframe que inviabilize `/embed/:installationId`.
- Completar automação de banco compatível com pgvector, migrações, papel runtime,
  API, worker, embeddings em rede privada e envio de e-mail. Confirmar provedor
  e domínio reais na implantação; não condicionar desenvolvimento a essa escolha.
- Manter segredos no servidor e separar permissões de migração, runtime e envio
  de e-mail. Configurar proxy confiável para que limitação por IP funcione.
- Validar que o worker publicado processa ambas as filas e que uma fila extensa
  de indexação não impede atendimento; ajustar alternância se a validação mostrar
  bloqueio. Corrigir a afirmação desatualizada em `docs/operations/deploy.md`
  sobre ausência de indexação contínua.
- Documentar instalação, atualização, rotação de segredos, limpeza de tokens e
  auditoria, backup, restauração e reativação de empresa pelo suporte.
- Definir metas de recuperação e retenção na operação; ensaiar restauração em
  ambiente isolado e rollback de aplicação compatível com as migrações aditivas.
- Monitorar erros, fila, falhas de e-mail, latência e limites por tenant, sem
  colocar conteúdo privado ou credenciais nos logs.

Aceite: ambiente limpo sobe com procedimento reproduzível, cadastro real envia
e-mail, artigo é indexado, widget responde e backup é restaurado com sucesso.

## Extensão opcional — API em outra origem

Somente se houver necessidade concreta: adicionar URL explícita do backend ao
cliente, `credentials: 'include'`, CORS administrativo com allowlist exata e
preflight; manter política independente do CORS público do widget. Diferenciar
origens distintas no mesmo site de sites distintos: cookies SameSite e bloqueio
de cookies de terceiros exigem testes específicos. Para cenário entre sites,
implementar proteção CSRF explícita e validar navegadores suportados antes de
prometer compatibilidade. Preferir proxy na origem do painel quando necessário.

## Verificação e critérios de liberação

Executar `npm run check`, `npm test`, `npm run test:db` e `npm run test:e2e`
com as dependências de cada suíte configuradas e banco de testes descartável.
Ausência de banco ou testes ignorados não conta como validação de isolamento.

Adicionar cobertura aos testes existentes de login, acesso e conhecimento,
criando suítes para onboarding, instalações, convites e recuperação:

- Duas empresas com dados distintos: tentar listar, ler e alterar recursos da
  outra, falsificar tenant e reutilizar IDs/tokens; verificar RLS com papel runtime.
- Reutilização de conexões não pode carregar contexto da empresa anterior.
- Cadastro/convite/recuperação concorrentes e repetidos; expiração, revogação,
  bloqueio por excesso de tentativas e último proprietário.
- Escritas sem origem válida, permissão insuficiente e empresa desativada.
- Fluxo de navegador: cadastro → confirmação → login → instalação → snippet →
  artigo publicado/indexado → widget externo → resposta baseada no artigo.
- Regressão de expiração de sessão, origens do widget, limites diário/concorrente,
  desativação e atualização de versão preservando os dados de ambas as empresas.

| Critério do problema | Evidência esperada |
| --- | --- |
| 1. Criar empresa por onboarding | E2E de cadastro e teste transacional |
| 2. Login sem alterar código | Login da conta recém-criada no ambiente implantado |
| 3. Configurar instalação e snippet | E2E de instalação com widget externo |
| 4. Isolamento entre empresas | Testes de API, banco/RLS e navegador com duas empresas |
| 5. Produção com API/banco/proxy | Smoke test HTTPS e navegação direta |
| 6. Widget em domínios autorizados | Casos positivos, negativos e revogação de origem |
| 7. Autenticação e expiração | Suítes de login, revogação, permissões e tokens |
| 8. Atualização centralizada | Atualização ensaiada preservando tenants e snippets |

## Sequência sugerida de entregas

1. Contratos, migrações, políticas e testes de autorização — etapa 1.
2. E-mail, cadastro, provisionamento e telas públicas — etapa 2.
3. API de empresa/instalações, snippet e limites — etapa 3.
4. Convites, recuperação, membros e segurança dos fluxos — etapa 4.
5. Integração da navegação e onboarding no painel — etapa 5, com as telas de cada
   recurso desenvolvidas junto à respectiva API.
6. Infraestrutura, ensaio operacional e aceite completo — etapa 6.

As bases de proxy e ambiente podem ser preparadas após a etapa 1. Cada entrega
deve incluir sua verificação; a última consolida o fluxo completo. Não liberar
cadastro público com dados reais antes de isolamento, recuperação, limites e
operação estarem validados. Nenhuma etapa exige copiar o produto por cliente.
