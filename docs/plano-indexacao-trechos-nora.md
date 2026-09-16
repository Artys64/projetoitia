# Indexação de trechos e integração com a Nora

Status: planejamento baseado no código inspecionado em 15/09/2026. Não implementado nesta revisão.

> Atualização de escopo: o usuário decidiu planejar pgvector e RAG completo. O [novo plano](plano-pgvector-rag-completo.md) prevalece sobre a sequência textual primeiro, o adiamento de embeddings e a preparação síncrona descritos abaixo. Este documento preserva a proposta anterior como referência.

Complementa [o plano do painel](plano-base-conhecimento-painel.md) e [o plano geral de RAG](plano-implementacao-rag.md). Perfis confirmados: admin gerencia o contexto; usuário utiliza o agente. As proteções administrativas e do widget continuam resolvendo a empresa no servidor.

## 1. Resultado esperado

Ao publicar conteúdo, preparar seus trechos uma vez e persistir o índice. A pergunta do usuário consulta somente os trechos publicados da empresa autorizada. Edição de rascunho mantém a publicação anterior; despublicação impede novas recuperações e bloqueia respostas em curso apoiadas nas fontes invalidadas.

Fluxo proposto:

```text
Admin/CLI → snapshot da versão → divisão → índice completo → ativação da publicação
                                                               ↓
Sessão do usuário → empresa autorizada → busca SQL → seleção de evidências → Nora
                                                                           ↓
                                              revalidar fontes → gravar resposta
```

## 2. Situação atual e pré-requisitos

- `db/knowledge.ts` carrega todos os artigos publicados da empresa e chama `createTextSearch` a cada consulta.
- `ia/knowledge/search.ts` divide o texto em trechos de até 900 caracteres e pontua palavras de título, keywords e corpo em JavaScript.
- Não há uso de pgvector, geração de embeddings ou índice vetorial no código/migrações examinados. Isso não determina quais extensões poderiam estar instaladas externamente no banco.
- Há dois escritores de publicações: `AdminKnowledgeStore.publish()` em `db/admin-knowledge.ts` e `importArticles()` em `db/admin.ts`. Ambos precisarão alimentar o mesmo indexador.
- `SearchHit`, `KnowledgeEvidence`, auditorias e o corpus usam artigo/versão/número do trecho. A versão do algoritmo ainda não faz parte da identidade.
- O worker confere empresa e versão publicada antes de gravar a resposta. A nova identidade deverá participar dessa conferência.
- O painel aceita 200.000 caracteres e publica em um único artigo, enquanto `validateArticles` aceita 50.000 por artigo e 1.000 artigos por lote. Isso pode fazer a publicação ser aceita e a busca falhar. Corrigir a divergência é pré-requisito, não resultado automático de indexar trechos.

Manter como referência o limite editorial de 50.000 caracteres por artigo. Documento de até 200.000 exige divisão editorial em seções revisáveis, conforme o plano do painel. Enquanto esse fluxo não estiver disponível, recusar explicitamente a publicação acima do limite, preservando o rascunho e a publicação anterior. Inventariar publicações já acima do limite e encaminhar sua regularização, sem truncar ou despublicar automaticamente. A ativação da busca nova depende da resolução desses casos. Uma revisão do limite seria uma decisão explícita, aplicada em todos os validadores.

## 3. Modelo de dados

Criar migração aditiva, usando o próximo número disponível, para:

| Estrutura proposta | Campos e responsabilidade |
| --- | --- |
| `article_chunk_sets` | Empresa, artigo, versão do artigo, versão do divisor, hash da entrada, quantidade de trechos, hash do conjunto, estado de conclusão e versão da configuração textual |
| `article_chunks` | Identidade composta do conjunto + posição, texto exato, hash, localização na origem quando disponível, metadados de seção e `tsvector` para busca |
| Referência ao conjunto publicado | Associar explicitamente a publicação ao conjunto completo; permitir transição dos artigos antigos enquanto a busca anterior continua ativa |
| Estratégia por empresa | Registrar qual estratégia de recuperação está habilitada; ativação controlada após preenchimento e avaliação |

Todas as referências ao artigo e ao conjunto incluem `tenant_id`. Habilitar e forçar RLS nas tabelas novas, com permissões mínimas para leitura e indexação. Validar com o papel real da aplicação. Proprietários e papéis com privilégios especiais podem contornar RLS, conforme a [documentação do PostgreSQL](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).

A identidade de uma evidência nova inclui empresa, artigo, versão, algoritmo e posição. Exemplo conceitual: `company_a/senha@3/legacy-v1#2`. O hash verifica integridade; conteúdo diferente nunca sobrescreve a mesma identidade. A leitura de auditorias antigas continua reconhecendo a identidade anterior.

## 4. Divisão e indexação

Criar `ia/knowledge/chunking.ts` para a divisão determinística e `db/knowledge-index.ts` para persistência e verificação dos conjuntos.

Primeira entrega: encapsular o divisor atual como `legacy-v1`, preservando seus resultados. Isso permite comparar a mudança de armazenamento e busca sem alterar simultaneamente a divisão. Congelar essa versão para o corpus histórico.

Entrega posterior dentro da evolução documental: adicionar uma versão que respeite títulos, listas, tabelas e blocos Markdown. Procedimentos que caibam no orçamento permanecem juntos. Blocos maiores serão divididos em fronteiras explícitas, com localização e avisos quando necessário; nenhum conteúdo é resumido ou descartado silenciosamente. Medir essa divisão separadamente antes de ativá-la.

O indexador deve:

1. Receber snapshot imutável, empresa autorizada e versões dos algoritmos.
2. Gerar trechos e metadados sem chamadas a modelo ou busca de recursos externos.
3. Persistir em lote com chaves compostas e escrita parametrizada.
4. Verificar quantidade, hashes e cobertura esperada para o algoritmo utilizado.
5. Marcar o conjunto completo somente depois da verificação.

Reexecução idêntica é idempotente. Colisão de identidade com texto/hash diferente é erro, não um `ON CONFLICT DO NOTHING` silencioso. Para `legacy-v1`, a cobertura respeita sua normalização existente de espaços; o divisor documental deverá preservar e verificar os intervalos do snapshot com regras explícitas.

## 5. Publicação atômica

Criar `db/knowledge-publication.ts`, compartilhado pelo painel e CLI.

Para a escala inicial, persistir versão, trechos, conclusão do índice e ponteiro publicado em uma transação curta e limitada. Cálculos determinísticos podem ser preparados antes; a transação final confere novamente o snapshot/revisão esperada, a autorização e a integridade do conjunto antes de ativá-lo. Falhas mantêm a versão anterior.

- Serializar alterações no mesmo artigo e alinhar a ordem dos bloqueios entre importador, editor e worker.
- Proteger contra revogação administrativa concorrente: a checagem atual em `AdminSessionStore.authorized()` ocorre antes do trabalho e não bloqueia, sozinha, uma revogação durante a transação. Definir bloqueios e conferência final compatíveis com os caminhos de revogação e publicação.
- Publicação repetida da mesma operação não deve criar versões sucessivas. Registrar sua identidade e comparar o conteúdo/revisão esperada; payload diferente conflita.
- Quando houver documento com várias seções, preparar e ativar o conjunto de artigos, retirando as seções substituídas na mesma transação. Essa capacidade depende do vínculo documento–seções do plano editorial.
- Despublicar retira a referência ativa sem apagar versões ou trechos históricos.
- Manter explícita a semântica da CLI: importar `draft` despublica; salvar rascunho editorial não despublica.

Se o volume ultrapassar os limites medidos da transação, passar a preparação para o executor documental e manter a ativação final atômica. Não usar os jobs de chat para indexação.

## 6. Busca textual no PostgreSQL

Substituir a carga integral de artigos em `db/knowledge.ts` por consulta aos conjuntos completos e ativos.

Proposta inicial: configuração textual de português, pesos distintos para título, keywords e corpo, índice GIN no `tsvector`, índices B-tree para os vínculos compostos e ordenação estável. O PostgreSQL oferece vetores textuais, pesos e funções de ranking; GIN é o índice preferido para busca textual. Referências: [controle da busca](https://www.postgresql.org/docs/18/textsearch-controls.html) e [índices textuais](https://www.postgresql.org/docs/18/textsearch-indexes.html).

Passos da consulta:

1. Validar consulta e empresa já autorizada pelo backend.
2. Restringir candidatos por empresa, versão publicada e conjunto completo antes do ranking e do limite.
3. Construir consulta textual parametrizada, com regra explícita para termos vazios, negações, códigos e hífens. Comparar a interpretação de linguagem natural com os casos anotados; não tratar todo hífen como exclusão de termo inadvertidamente.
4. Recuperar inicialmente até 12 candidatos e selecionar até quatro evidências dentro do orçamento atual de 5.000 caracteres de JSON por busca.
5. Avaliar redundância, cobertura e diversidade. Evitar que títulos iguais ocupem todos os resultados com trechos pouco relevantes; preservar partes complementares de um procedimento.

Os valores são parâmetros iniciais a medir. Os limiares do ranking JavaScript não se transferem diretamente para os escores SQL. Busca vazia e falha técnica continuam distintas. Uma falha do índice não será convertida em resposta de ausência de informação.

## 7. Integração com a Nora

Preservar a assinatura `KnowledgeSearch(query, companyId)` e evoluir explicitamente seu resultado para incluir a identidade versionada do conjunto/trecho.

- `context.ts`: validar integridade e empresa, identificar as novas fontes e selecionar trechos sem ultrapassar o orçamento de contexto.
- `agents/nora.ts`: adaptar deduplicação e passagem de evidências. O modelo continua recebendo apenas a consulta como argumento da ferramenta; a empresa vem do servidor.
- `generated-response.ts`: transportar a identidade completa na resposta interna e na auditoria.
- `db/worker.ts`: conferir, antes da gravação, empresa, versão publicada, conjunto autorizado e identidade/hash das fontes. Bloquear fonte invalidada durante a geração.
- `ia/runtime.ts`, `ia/service.ts` e `app.ts`: ajustar a composição quando necessário, mantendo a busca escolhida no backend.

Preservar inicialmente duas buscas e três etapas de geração. Não alterar prompt e modelo junto com o primeiro experimento de indexação. Testes administrativos que venham a consumir essa busca devem usar o mesmo serviço e a mesma regra de validação de fontes publicadas.

## 8. Dados existentes e ativação

Adicionar operação CLI de preenchimento dos índices por empresa, paginada, retomável e idempotente. O nome e os argumentos do comando serão definidos na implementação; não existe esse comando hoje.

Ordem de ativação:

1. Aplicar migração aditiva e implantar leitores compatíveis com evidências antigas e novas.
2. Atualizar todos os escritores para preparar índices nas novas publicações.
3. Inventariar limites e preencher as versões publicadas existentes em lotes, sem alterar seus textos.
4. Conferir novamente o conjunto publicado, inclusive publicações concorrentes ao preenchimento.
5. Comparar a busca nova com a referência nos casos de desenvolvimento e habilitar por empresa.

Até a ativação, a estratégia anterior permanece selecionada. Um erro de busca não troca automaticamente de estratégia. O retorno operacional exige verificar compatibilidade dos conteúdos, limites e identidades; o caminho antigo não é um fallback válido para bases que ultrapassam seus limites. Preservar os conjuntos necessários às auditorias e às respostas em curso.

## 9. Avaliação e critérios de aceite

- Testes de divisão: determinismo, limites, cobertura, Unicode, texto sem espaços, listas, tabelas e código.
- Testes PostgreSQL: chaves compostas, RLS, índice incompleto, colisões, publicação repetida, rollback após falha e preenchimento concorrente.
- Testes de isolamento: mesmo artigo em duas empresas, busca vazia em uma, pool reutilizado e pedidos concorrentes. Inspecionar o conteúdo efetivamente enviado ao modelo simulado.
- Testes de publicação: salvar rascunho mantém a versão ativa; publicar muda a busca sem reiniciar; despublicar bloqueia nova recuperação e resposta em curso; revogação administrativa concorrente impede publicação indevida.
- Adaptar `scripts/lib/nora-quality.mts` para preservar o divisor e o corpus históricos, e adicionar casos anotados de recuperação. O avaliador atual de três perguntas não é suficiente para comparar estratégias.
- Comparar top-4, cobertura de procedimentos e regressões nos 24 casos de desenvolvimento; reservar os 16 casos de validação. Separar erros de busca, conteúdo e geração.
- Medir planos de consulta e latência com `EXPLAIN (ANALYZE, BUFFERS)` em bases sintéticas de 100, 1.000 e 10.000 artigos. A referência antiga falha acima de seus limites; registrar essa restrição na comparação.
- Meta proposta do plano geral: p95 de busca até 200 ms para 10.000 artigos e dez buscas concorrentes, com ambiente documentado. Isso ainda não é resultado medido.
- Testes locais usam modelo simulado. Avaliações reais de IA exigem orçamento registrado antes das chamadas.

## 10. Entregas revisáveis e módulos

| Entrega | Principais módulos |
| --- | --- |
| 1. Contrato e limites | `packages/contracts/src/knowledge.ts`, `ia/knowledge/repository.ts`, validações editoriais, testes de referência |
| 2. Persistência e divisor versionado | Nova migração, novos `ia/knowledge/chunking.ts` e `db/knowledge-index.ts`, provisionamento |
| 3. Publicação integrada | Novo `db/knowledge-publication.ts`, `db/admin-knowledge.ts`, `db/admin.ts`, `db/admin-sessions.ts` |
| 4. Busca e evidências | `db/knowledge.ts`, `ia/knowledge/search.ts`, `context.ts`, `agents/nora.ts`, `generated-response.ts`, `db/worker.ts` |
| 5. Preenchimento e ativação | `db/cli.ts`, configuração por empresa, testes PostgreSQL, avaliação e documentação operacional |
| 6. Divisão documental aprimorada | Nova versão em `chunking.ts`, fixtures Markdown, comparação de cobertura e integração com seções editoriais |

## 11. pgvector no escopo atual

O adiamento original foi substituído por decisão do usuário. Embeddings e recuperação híbrida fazem parte do [plano de pgvector e RAG completo](plano-pgvector-rag-completo.md), incluindo worker próprio, perfil versionado, publicação assíncrona e avaliação. A elaboração do plano não provisionou infraestrutura nem executou chamadas de embeddings.
