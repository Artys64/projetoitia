# Deploy

Status: configuração preparada, implantação não registrada  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

`render.yaml` descreve API, worker e PostgreSQL de homologação. Revise região,
planos, custos e segredos antes de aplicar. O arquivo é uma base de configuração,
não evidência de que os serviços estejam publicados.

## Ordem

1. Provisione PostgreSQL compatível com pgvector.
2. Configure `MIGRATION_DATABASE_URL` com o proprietário.
3. Configure `DATABASE_URL` com o papel limitado da aplicação.
4. Aplique migrações e execute o provisionamento no pre-deploy.
5. Disponibilize `EMBEDDINGS_URL` em rede privada para API e worker.
6. Configure `GROQ_API_KEY` somente no worker.
7. Configure `ADMIN_ORIGIN` com a origem HTTPS exata do painel.
8. Inicie API e worker e valide `/api/health`.
9. Cadastre instalações HTTPS e execute a homologação entre origens.

O manifesto atual deve ser revisado antes do uso: o worker exige
`EMBEDDINGS_URL`, o serviço de embeddings não está definido no próprio
`render.yaml` e ainda falta um serviço contínuo para consumir a fila de
indexação de conhecimento.

## Verificações de liberação

Execute build, testes, migrações em base descartável, smoke test do health check,
login administrativo, publicação de conhecimento, chat completo e isolamento
entre duas empresas. Defina também backup/restauração, alertas e procedimento de
rollback antes de dados reais.
