# Administrar a base de conhecimento

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Preparar o acesso

A empresa deve existir no banco. Configure `ADMIN_USERNAME` e
`ADMIN_PASSWORD` apenas durante o cadastro e execute:

```bash
npm run db -- admin-create company_a
```

A senha deve ter entre 12 e 256 caracteres. O comando não substitui uma conta
existente. Depois do cadastro, remova a senha do arquivo de ambiente e entre no
painel com usuário e senha. A sessão dura sete dias; sair a revoga.

## Criar e editar

O painel aceita texto e Markdown digitados ou arquivos `.txt` e `.md` em UTF-8.
O arquivo pode ter até 1 MiB e o conteúdo, até 200.000 caracteres.

Salvar altera somente o rascunho. A edição usa a revisão esperada para detectar
concorrência; recarregue o item antes de repetir uma gravação rejeitada por
conflito.

## Publicar e despublicar

Publicar cria uma tarefa assíncrona de indexação. Execute
`npm run knowledge:index` para consumir a fila e acompanhe o progresso até o
estado `active`. A publicação anterior continua disponível durante o processo.
Uma falha não ativa trechos parciais. O comando atual encerra quando a fila fica
vazia; execute-o novamente após novas publicações até existir um serviço
contínuo de indexação.

Despublicar retira o conteúdo da busca sem apagar o rascunho. Excluir remove o
item administrativo e invalida a publicação correspondente. Essas ações são
sempre limitadas à empresa da sessão.

Use somente informações verificadas do produto. Para avaliar recuperação e
respostas depois de uma mudança relevante, siga [Avaliar a Nora](avaliar-nora.md).
