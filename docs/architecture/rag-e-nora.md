# RAG e Nora

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Publicação do conhecimento

O painel mantém rascunho e publicação separados. Ao publicar, a API cria um job
versionado. O indexador iniciado por `npm run knowledge:index` divide o conteúdo
em trechos, gera embeddings e ativa o conjunto inteiro de forma transacional.
Uma indexação incompleta não substitui a versão publicada anteriormente.

O perfil atual usa `intfloat/multilingual-e5-small`, revisão fixada, vetores de
384 dimensões e os prefixos `query:` e `passage:`. O serviço recusa entradas
acima do limite em vez de truncá-las silenciosamente.

## Recuperação

A busca combina full-text em português e similaridade vetorial dentro do
PostgreSQL. Os rankings são combinados por reciprocal rank fusion. A consulta é
sempre limitada à empresa, ao perfil e à publicação ativa antes de chegar à
Nora.

Até quatro evidências, dentro do orçamento de 5.000 caracteres, podem compor o
contexto. Artigos em rascunho, versões substituídas e conteúdo de outra empresa
não participam da recuperação.

## Geração e validação

A Nora usa o histórico para interpretar a intenção, mas trata somente as
evidências recuperadas como fonte de fatos do produto. A geração registra modelo,
prompt, duração, consumo e identidades das fontes. Perguntas e respostas não
entram no registro resumido de auditoria.

O fluxo atual usa uma única geração com instruções de fundamentação. Depois da
chamada, valida entrada, presença e tamanho da saída e trata falhas de busca,
timeout ou geração antes de publicar. Ele não possui hoje um segundo modelo
verificador; as instruções reduzem invenções, mas não oferecem garantia
determinística de correção semântica.

Sem Groq, o endpoint legado `/api/chat` possui um fallback textual para
desenvolvimento. Esse caminho não substitui o worker do chat persistente.
