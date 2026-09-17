# Demonstração do produto

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Demonstração visual

Para validar layout, navegação e instalação do snippet sem banco ou IA:

```bash
npm install
npm run demo:visual
```

Abra <http://localhost:4174>. A área de mensagens informa que o chat persistente
está indisponível nesse modo.

## Demonstração completa

A demonstração completa exige PostgreSQL com pgvector, o serviço local de
embeddings e uma chave Groq. Preencha `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `EMBEDDINGS_URL` e `GROQ_API_KEY` em
`apps/api/.env.local`, depois execute:

```bash
npm run demo
```

O comando valida configuração e portas, compila o monorepo, aplica a preparação
das duas empresas fictícias e inicia API, worker e host.

| Endereço | Finalidade |
| --- | --- |
| <http://localhost:3000> | API e recursos públicos do widget |
| <http://localhost:4174/a.html> | Aurora Studio (`inst_demo_a`) |
| <http://localhost:4174/b.html> | Jardim & Casa (`inst_demo_b`) |
| <http://localhost:4174/without.html> | Página de comparação sem snippet |
| <http://localhost:4174/admin> | Painel administrativo |

Pergunte “Qual é o horário de atendimento?” nas duas instalações para conferir
o isolamento. Aurora e Jardim & Casa possuem respostas fictícias distintas.

## Acesso administrativo

Depois de migrar e provisionar o banco, configure temporariamente:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=uma_senha_com_12_ou_mais_caracteres
```

Crie a conta de uma empresa existente e inicie a demonstração:

```bash
npm run db -- admin-create company_a
npm run demo
```

O cadastro não substitui contas existentes. A senha é armazenada como hash
scrypt com salt; remova `ADMIN_PASSWORD` do arquivo após o cadastro. O comando
legado `admin-session` continua disponível para integrações existentes.

Para preparar banco e embeddings desde o início, siga
[Banco e migrações](../operations/banco-e-migracoes.md).
