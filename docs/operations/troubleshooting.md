# Solução de problemas

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## A API não inicia

- Em produção, confirme `DATABASE_URL`.
- Confira se `TRUST_PROXY_HOPS` é inteiro entre 0 e 3.
- Se houver banco, aplique `npm run db -- migrate`.
- Use um papel de runtime sem `SUPERUSER` e `BYPASSRLS`.

## O worker não inicia

Ele exige `DATABASE_URL`, `GROQ_API_KEY` e `EMBEDDINGS_URL`. Confirme que o
endpoint de embeddings responde e que o modelo está montado no container.

## O widget não aparece

Abra diretamente `/loader.js` e `/embed/:installationId`. Confirme build,
instalação ativa, origem autorizada e CSP do host. IDs desconhecidos retornam
404; instalações desativadas, 403. Erros também chegam pelo evento global
`supporthub:error`.

## O chat não recupera o histórico

Verifique se o navegador permite armazenamento no iframe e se a sessão ainda
está válida. Sessão expirada ou revogada não dá acesso ao histórico antigo.

## O painel rejeita gravações

Confirme `ADMIN_ORIGIN` exata, cookie da sessão e revisão esperada do item. Em
produção, origem e cookie exigem HTTPS. Após conflito de edição, recarregue o
registro antes de salvar novamente.

## A Nora não encontra conteúdo novo

Confira se a publicação chegou a `active`, se o indexador está sendo executado
e se `EMBEDDINGS_URL` usa o perfil esperado. Para dados antigos, enfileire
`knowledge-backfill` e execute `npm run knowledge:index`.
