# Problema: painel administrativo independente e multiempresa

Status: proposta

## Contexto

O Support Hub possui um painel administrativo em React/Vite e uma API em
Fastify. O painel permite autenticação administrativa e gerenciamento da base
de conhecimento de uma empresa. O widget público, por sua vez, pode ser
instalado em sites externos por meio de um `loader.js`.

Atualmente, o painel e a API fazem parte do mesmo monorepo e o frontend usa
rotas relativas, como `/api/admin/...`. Em desenvolvimento, a comunicação
depende do proxy do Vite para `http://localhost:3000`.

## Problema

Ao copiar apenas o script ou a pasta do painel para outro projeto, o painel
administrativo não funciona de forma independente. O script público carrega o
widget, mas não contém o painel, a autenticação, a API, o banco de dados ou os
processos responsáveis pela IA e indexação.

Além disso, o painel atual não oferece todo o fluxo necessário para uma nova
empresa entrar sozinha na plataforma. Ainda é necessário configurar
manualmente banco, migrações, credenciais, empresa, usuário administrativo,
instalação e origens autorizadas.

## Impactos

- Cada nova empresa exige configuração técnica manual.
- Copiar o painel para outro projeto não cria uma instalação funcional.
- O frontend depende de a API estar na mesma origem ou atrás de um proxy.
- Não existe um fluxo completo de cadastro e provisionamento de empresas.
- O gerenciamento de instalações e domínios autorizados ainda não está
  disponível como uma experiência completa no painel.
- A implantação por cliente pode gerar duplicação de código e dificuldade de
  atualização.
- A operação e o suporte ficam dependentes da equipe técnica.

## O que já existe

O banco já possui elementos importantes para uma arquitetura multiempresa:

- empresas representadas por `tenants`;
- usuários administrativos em `admin_users`;
- vínculo entre usuários e empresas em `admin_memberships`;
- sessões administrativas associadas à empresa;
- instalações do widget associadas ao tenant;
- artigos e versões associados ao tenant;
- Row-Level Security para isolamento dos dados.

O backend também resolve a empresa a partir da sessão administrativa. Portanto,
o `tenant_id` não deve ser recebido do frontend como mecanismo de autorização.

## Causas principais

### Acoplamento de origem

O painel chama a API com URLs relativas. Isso funciona quando o painel e a API
compartilham a mesma origem ou quando existe um proxy reverso configurado, mas
não funciona automaticamente quando são publicados em projetos ou domínios
separados.

### Infraestrutura distribuída

O funcionamento completo depende de mais componentes além do frontend:

- API;
- PostgreSQL compatível com as migrações do projeto;
- worker para processar respostas e tarefas;
- serviço de embeddings para busca semântica;
- credencial do provedor de IA, quando o modo de produção for utilizado.

### Ausência de onboarding

Não há ainda um fluxo de produto para criar uma empresa, criar seus usuários,
configurar uma instalação, cadastrar os domínios permitidos e disponibilizar o
snippet do widget.

### Autenticação administrativa incompleta para produto SaaS

O projeto possui login administrativo, mas uma solução independente para várias
empresas ainda precisa de recursos operacionais como convite de usuários,
recuperação de senha, papéis e permissões, proteção contra abuso e gestão do
ciclo de vida das contas.

## Resultado esperado

Disponibilizar uma plataforma centralizada em que cada empresa possa acessar o
próprio painel, configurar seu widget e administrar sua base de conhecimento
sem receber uma cópia do código ou depender de configuração manual da equipe
técnica.

Uma implantação esperada seria:

```text
site da empresa
      |
      +--> loader.js e widget
      |
      +--> API Support Hub
              |
              +--> banco multi-tenant
              +--> worker e IA

painel.seudominio.com --> frontend administrativo + /api
```

## Requisitos de solução

### Painel centralizado

O painel deve ser publicado em um domínio próprio, por exemplo
`https://painel.seudominio.com`, com a API disponível na mesma origem por meio
de proxy reverso ou gateway.

### Provisionamento de empresas

O sistema deve permitir:

- criar e desativar empresas;
- criar o primeiro administrador da empresa;
- convidar outros usuários;
- criar e editar instalações;
- cadastrar origens permitidas;
- gerar o snippet de instalação;
- configurar marca, saudação e limites de uso.

### Isolamento de dados

Toda consulta e escrita deve continuar vinculada ao tenant obtido da sessão.
As políticas RLS devem permanecer habilitadas e ser cobertas por testes de
isolamento entre empresas.

### Configuração externa da API

Se o painel precisar ficar em domínio diferente da API, deve existir uma
configuração explícita de URL da API, CORS restrito, cookies seguros e proteção
contra CSRF. A opção preferida é manter painel e API na mesma origem pública.

### Segurança de produção

São necessários HTTPS, cookies `Secure` e `HttpOnly`, origem administrativa
exata em `ADMIN_ORIGIN`, expiração e revogação de sessões, limitação de
tentativas de login e recuperação segura de acesso.

### Empacotamento e operação

O produto deve possuir documentação e automação para:

- instalar dependências;
- executar migrações;
- provisionar uma empresa;
- iniciar API, worker e embeddings;
- configurar segredos;
- realizar backup e restauração;
- atualizar versões sem duplicar código.

## Alternativas de implantação

### SaaS compartilhado — recomendada

Uma única plataforma atende várias empresas. Os dados são isolados por tenant,
com autenticação e RLS.

Vantagens: atualização centralizada, menor custo operacional e onboarding mais
rápido.

### Instalação dedicada

Cada empresa recebe uma API, banco e configuração próprios.

Vantagens: maior isolamento e possibilidade de atender requisitos específicos
de segurança ou compliance.

Desvantagens: custo maior, atualizações repetidas e necessidade de operar várias
instâncias.

## Critérios de conclusão

O problema estará resolvido quando:

1. uma empresa puder ser criada pelo fluxo de onboarding;
2. seu administrador puder entrar no painel sem configuração manual no código;
3. a empresa puder configurar uma instalação e obter seu snippet;
4. duas empresas puderem usar o mesmo painel sem enxergar dados uma da outra;
5. o painel funcionar em produção com API, banco e proxy configurados;
6. o widget continuar funcionando em domínios externos autorizados;
7. os testes comprovarem isolamento, autenticação e expiração de sessões;
8. a atualização do produto não exigir copiar o código para cada cliente.

## Direção recomendada

Evoluir o projeto para um SaaS multiempresa centralizado. O widget deve
continuar sendo distribuído como script instalável, enquanto o painel, a API e
os serviços de suporte devem ser mantidos em uma infraestrutura própria do
Support Hub. A instalação dedicada pode ser oferecida posteriormente como uma
variante para clientes com requisitos especiais.
