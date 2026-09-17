# Segurança e isolamento

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Fronteiras de identidade

- O visitante é identificado por um Bearer opaco associado no servidor à
  instalação, empresa e visitante.
- O administrador usa cookie `HttpOnly` e `SameSite=Strict`; a empresa vem da
  sessão e não de um campo enviado pela interface.
- O worker recebe a empresa do job persistido e revalida publicação, versão e
  hash antes de concluir o trabalho.
- O papel PostgreSQL de runtime não pode ter `SUPERUSER` nem `BYPASSRLS`.

Todas as consultas sensíveis executam dentro do contexto da empresa. A ausência
de conteúdo nunca autoriza uma busca global ou o uso de conteúdo de outra
empresa.

## Widget entre origens

Instalações aceitam somente origens exatas. Em produção, origens precisam usar
HTTPS e não aceitam curingas. Loader e widget validam origem, janela, instalação,
instância e formato do envelope antes de aceitar comandos.

O HTML do iframe recebe `frame-ancestors` específico. A página hospedeira deve
autorizar a origem do produto em `script-src`, `frame-src` e `style-src`. Não use
`X-Frame-Options: DENY` ou `SAMEORIGIN` no endpoint incorporável.

## Administração

Escritas administrativas exigem a origem exata configurada em `ADMIN_ORIGIN`.
O login tem limite por IP. Senhas são derivadas com scrypt e salt; a variável
`ADMIN_PASSWORD` existe somente para o cadastro inicial pelo CLI.

A aplicação redige cabeçalhos `Authorization` e `Cookie` dos logs. Chaves Groq,
URLs de banco e tokens não devem entrar em HTML, JavaScript público ou arquivos
versionados.
