> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# pgvector e RAG completo da Nora

Data: 15/09/2026. Atualizado em 16/09/2026. Status: núcleo R0–R6 implementado e validado localmente; avaliação de escala e preparação de produção de R7 continuam pendentes.

## Estado da implementação

- PostgreSQL 18 com pgvector 0.8.6, migrações aditivas, RLS e testes em container real.
- `multilingual-e5-small` fixado na revisão `fd1525a9fd15316a2d503bf26ab031a61d056e98`, executado localmente e offline, com vetores normalizados de 384 dimensões.
- Divisão versionada, fila durável, escrita em lotes curtos, renovação de lease e ativação atômica; uma falha mantém o conjunto publicado anterior.
- Busca híbrida restrita à empresa e ao conjunto ativo no SQL: full-text em português, similaridade vetorial exata e fusão RRF. O caminho PostgreSQL não carrega todos os artigos para a memória.
- Publicação assíncrona no painel/CLI, progresso, backfill, fontes persistidas e revalidadas antes da resposta e ao abrir no widget.
- Homologação local feita com oito artigos e consulta sem cobertura calibrada para não retornar vizinhos apenas por proximidade. A calibração ampla, teste em 10.000 artigos, backup/restauração e ativação gradual permanecem em R7.

Decisão do usuário: incluir pgvector e embeddings no escopo principal do RAG. Este documento prevalece sobre o adiamento da busca vetorial nos planos anteriores. Os requisitos de publicação, privacidade e isolamento do [plano do painel](plano-base-conhecimento-painel.md) continuam obrigatórios.

Decisões adicionais confirmadas: embeddings executados localmente, sem API externa de embeddings; o worker de atendimento executa o RAG e monta o contexto exclusivamente da empresa vinculada ao job. A integração Groq de geração de respostas permanece no desenho atual; essa escolha local não implica trocar o gerador.

## 1. Objetivo e escopo

Entregar o fluxo completo para texto e Markdown: admin cria/importa, revisa e solicita publicação; o sistema prepara trechos e embeddings; ativa a versão completa; o usuário consulta a Nora; a resposta utiliza evidências publicadas da empresa e permite consultar as fontes autorizadas.

Perfis: admin organiza o contexto; usuário utiliza o agente. RAG recupera conhecimento durante o atendimento, sem treinar o modelo gerador com os documentos. PDF/DOCX continuam posteriores; OCR, crawler, permissões por visitante e ações em contas exigem escopo próprio.

### Caminhos principais

```text
Admin → texto/Markdown → revisão → pedido de publicação → job durável
       → trechos → embeddings → validação do conjunto → publicação atômica

Usuário → sessão/empresa → Nora formula consulta → embedding da consulta
        → busca textual + busca vetorial na empresa → fusão → evidências
        → resposta → revalidar sessão/fontes → persistir → mostrar fontes
```

## 2. Decisões técnicas

| Tema | Direção proposta |
| --- | --- |
| Banco | PostgreSQL atual com extensão `vector`; não exige mudar para Supabase |
| Recuperação | Híbrida: busca textual em português e similaridade vetorial |
| Embeddings | Modelo local `intfloat/multilingual-e5-small`, revisão fixada e homologada no ambiente local |
| Execução | Worker de atendimento executa RAG por empresa; fila/worker de conhecimento prepara documentos |
| Publicação | Preparação assíncrona; ativação atômica após todos os índices estarem prontos |
| Busca vetorial inicial | Exata sobre o conjunto autorizado; referência para avaliar HNSW |
| HNSW | Etapa de desempenho, com isolamento físico por empresa quando adotado e medição contra a busca exata |
| Modelo gerador | Reaproveitar integração Groq existente; embeddings têm configuração própria |
| Evidências | Texto exato, identidade estável e referências estruturadas validadas no servidor |

O usuário escolheu execução local. A proposta inicial é `intfloat/multilingual-e5-small`, com 384 dimensões, suporte multilíngue incluindo português e licença MIT. O modelo exige os prefixos `query: ` e `passage: ` e limita a entrada a 512 tokens. Isso fundamenta a proposta de `vector(384)`; a qualidade nos documentos da Nora ainda precisa ser medida ([model card](https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md)). Fixar revisão, tokenizer e normalização no perfil antes de indexar.

### Serviço local de embeddings

Proposta de runtime: processo privado de inferência com Sentence Transformers, carregando os pesos uma vez e atendendo aos workers pela rede interna. A biblioteca permite carregar artefatos locais e fixar revisão; configurar `local_files_only=True` e `trust_remote_code=False` ([documentação](https://sbert.net/docs/package_reference/sentence_transformer/model.html)). O download dos pesos ocorre na preparação da imagem/artefato, sem textos de clientes, e não durante consultas.

- Começar a homologação em CPU; medir RAM, tempo de carregamento, concorrência e latência antes de dimensionar produção. GPU e quantização dependem dessa medição.
- Serviço sem porta pública, com acesso somente dos componentes autorizados; não armazenar histórico nem conteúdo entre requisições. Pesos compartilhados não significam contexto compartilhado.
- Priorizar embeddings de consultas sobre lotes de indexação, limitar fila/lote/threads e aplicar timeout/cancelamento. Reservar capacidade para atendimento durante reindexação.
- Aquecer o modelo e verificar dimensão/hash do perfil antes de anunciar prontidão. Falha ou falta de pesos locais torna o serviço indisponível; não baixar modelos nem recorrer a API externa silenciosamente.
- Contar tokens com o tokenizer local antes da inferência, incluindo prefixos, títulos e tokens especiais. Repartir entradas grandes antes de indexar; não aceitar a truncagem automática da biblioteca como ingestão válida.

### Responsabilidade do worker por empresa

O worker de atendimento já recebe `tenantId`, conversa e lease no job. Ele revalida a autorização, carrega somente o histórico daquela conversa, cria a busca vinculada à empresa e executa o agente. Quando a Nora consulta conhecimento, o worker obtém o embedding local, consulta pgvector e o índice textual da mesma empresa, seleciona evidências e monta o contexto. A última transação revalida fontes e sessão antes de persistir a resposta.

O mesmo pool de workers pode atender várias empresas. Cada job captura uma empresa imutável, com estado, orçamento, histórico e caches separados; não é necessário um processo ou modelo exclusivo por empresa. O contexto é montado por pergunta com os trechos relevantes, sem manter um prompt global mutável contendo a base inteira de uma empresa.

A preparação documental usa jobs próprios, identificados por empresa, revisão e perfil. Eles atualizam os índices após mudanças editoriais. O atendimento consulta índices prontos, evitando refazer embeddings dos documentos em cada pergunta. Testes do painel devem reutilizar essa execução com identidade administrativa própria; buscas da Ajuda usam o mesmo serviço de recuperação sem chamar o gerador.

## 3. Fundação e compatibilidade

### Banco e testes

1. Conferir versões reais do PostgreSQL e da extensão disponíveis no ambiente de destino antes da migração. A documentação do Render lista suporte à extensão `vector`, mas a disponibilidade/versão do banco concreto ainda precisa ser verificada ([Render](https://render.com/docs/postgresql-extensions)).
2. Preparar ambiente de teste com PostgreSQL e pgvector reais, em container isolado e imagem fixada por versão/digest compatível com o major atual. Não apontar os testes para o banco operacional nem reutilizar seu volume.
3. Adaptar `apps/api/test/postgres.ts` e `helpers.ts`: o PostgreSQL embutido atual não deve ser considerado compatível com a extensão sem verificação. As suítes que aplicam todas as migrações precisarão de um backend de teste que tenha pgvector; não ignorar a migração vetorial para obter testes verdes.
4. Separar instalação/disponibilidade da extensão e sua habilitação por migração. A conta da aplicação permanece sem privilégios de instalação, SUPERUSER ou BYPASSRLS.

O pgvector documenta instalação em Docker e habilitação com `CREATE EXTENSION vector`. Índices HNSW com `vector` suportam até 2.000 dimensões; a proposta de 384 dimensões é compatível com esse limite ([pgvector](https://github.com/pgvector/pgvector)). A dimensão final será fixada com o perfil homologado, sem misturar vetores de outra dimensão.

### Estado do código

Consolidar testes e builds antes de implementar. Há alterações simultâneas no workspace; registrar a revisão/diff validado e preservar trabalhos existentes. O fluxo executável inspecionado continua `runtime.ts → generated-response.ts → agents/nora.ts`; a presença de arquivos de verificação isolados não significa que exista verificador ativo. Conferir referências órfãs antes de ampliar contratos.

Resolver a divergência de tamanho: rascunhos do painel chegam a 200.000 caracteres, enquanto o caminho atual de busca valida 50.000 por artigo. Manter até 50.000 por seção/artigo e até 200.000 por documento, com divisão editorial visível e ajustável para documentos maiores. Detectar conteúdos antigos fora do limite antes da ativação; não truncar ou retirar publicações automaticamente. A primeira publicação documental depende dessa divisão ou de uma revisão explícita e uniforme dos limites.

## 4. Dados e identidades

Criar migrações aditivas com o próximo número disponível. Os nomes abaixo são propostas; conferir tabelas que eventualmente já existam ao iniciar.

| Entidade | Responsabilidade |
| --- | --- |
| Documento/revisão | Origem privada, texto revisado, formato e seções editoriais; reutilizar/adaptar rascunhos existentes |
| `knowledge_publications` | Pedido idempotente, autor/empresa, revisão esperada, seções/versões do snapshot e estado da publicação |
| `knowledge_index_sets` | Manifesto do conjunto: versões de divisão e embeddings, hashes, quantidade esperada/concluída e completude |
| `knowledge_chunks` | Empresa, artigo/versão, identidade do conjunto, posição, texto literal, hash, localização, títulos de seção e `tsvector` |
| `knowledge_embeddings` | Referência composta ao trecho, perfil do modelo, hash exato da entrada, vetor e metadados de geração |
| `knowledge_index_jobs` | Fila durável, tentativa, lease/token, progresso, orçamento reservado, erro classificado e cancelamento |
| Configuração de recuperação por empresa | Estratégia ativa, perfil vetorial e geração do índice/base; controla ativação e migração |

O perfil de embeddings é imutável e identifica fornecedor, modelo/revisão, dimensão, métrica, normalização e versões dos templates de entrada para documento e consulta. A localização do vetor permite separar tabelas/partições por perfil quando a dimensão mudar. Não comparar vetores de modelos diferentes mesmo que tenham a mesma dimensão.

Todas as relações editoriais incluem `tenant_id`; aplicar RLS e referências compostas. Metadados globais de perfil contêm configuração técnica, sem conteúdo de empresas. O papel do chat lê somente trechos autorizados; o processador escreve índices da empresa vinculada ao job. Conferir privilégios efetivos dos papéis reais, incluindo acesso direto a partições se adotadas.

Cada fonte identifica empresa, artigo, versão, conjunto e trecho; hashes distinguem o texto literal do texto preparado para embedding. Cabeçalhos adicionados ao embedding são metadados, sem fingir que pertencem ao trecho literal. Versões antigas e suas identidades permanecem interpretáveis nas auditorias.

## 5. Importação, divisão e embeddings

### Importação e revisão

Texto digitado e TXT/Markdown UTF-8 alimentam o mesmo fluxo editorial. Upload recebe validação e limites próprios, original privado durável, confirmação do arquivo e reconciliação de órfãos. A revisão mostra texto, avisos e divisão em seções; enviar arquivo não o publica. Essa parte reaproveita as entregas de upload/revisão do plano do painel e não depende de chamadas ao modelo gerador.

### Divisão

Criar um divisor determinístico por blocos de texto/Markdown, preservando procedimentos, títulos, listas e tabelas quando couberem. Versionar o algoritmo e congelar o divisor antigo para comparação com o corpus histórico.

Hipótese inicial a avaliar: alvo de 250 tokens por trecho, máximo de 400, até 40 tokens de sobreposição em fronteiras onde isso ajude. Os limites dependem do tokenizer escolhido; caracteres não substituem a medição. Tabelas/procedimentos maiores são divididos explicitamente com localização e contexto de seção. Cobertura integral do documento e seleção parcial para cada resposta são verificações distintas.

O limite atual de 5.000 caracteres de JSON por busca permanece inicialmente. Portanto, até quatro fontes podem caber, mas quatro trechos não são garantidos. Medir cobertura antes de mudar esse orçamento; contar também prompt, histórico e resultados das duas buscas.

### Processador

1. Reservar cota e criar pedido/job durável a partir do snapshot aprovado pelo admin.
2. Reclamar o job com lease e token; carregar somente sua empresa, snapshot e perfil.
3. Preparar os trechos e gerar embeddings em lotes limitados, fora de transações de banco.
4. Validar quantidade, correspondência de cada vetor com a entrada, dimensão, valores finitos e norma apropriada à métrica; rejeitar vetor zero para cosseno.
5. Persistir lotes e uso; reexecutar somente itens pendentes. Chave de reaproveitamento inclui empresa, perfil e hash exato da entrada.
6. Conferir hashes, cobertura, contagem e perfil de todos os itens; concluir somente com lease ainda válido.

Novas tentativas têm limite, atraso progressivo e orçamento computacional próprio. Erros de timeout/saturação do serviço local podem ser repetidos dentro desse orçamento; erro de formato, dimensão ou artefato exige tratamento específico. Uma resposta de inferência perdida pode exigir repetir o cálculo; a persistência é idempotente, sem promessa de execução exatamente uma vez. Uso desconhecido do gerador externo continua registrado separadamente.

Não carregar conteúdo de outra empresa por deduplicação. O worker documental funciona sem chave Groq, usando somente seu banco, armazenamento e serviço local de embeddings.

## 6. Publicação e cancelamento

O botão Publicar passa a solicitar processamento: resposta HTTP `202` com identificador da operação. Painel e CLI utilizam o mesmo serviço; o painel acompanha progresso após recarga. O estado editorial e o estado da indexação aparecem separadamente.

Quando tudo estiver pronto, executar uma transação curta que:

- Confere pedido, revisão esperada, intenção de publicação vigente e versão da configuração.
- Revalida usuário/associação administrativa e empresa; registra a autoridade do pedido e não depende apenas de uma sessão antiga capturada no navegador. A semântica de revogação deve ser testada no momento da ativação.
- Bloqueia os artigos afetados em ordem estável, compatível com CLI e worker de chat.
- Ativa versões e conjuntos completos, retira seções substituídas e registra evento editorial.

Falha da nova indexação mantém a publicação anterior. Salvar um rascunho novo durante processamento invalida a ativação automática do snapshot anterior nesta primeira versão: o admin solicita publicação novamente. Publicar/retry idempotentes preservam a identidade da operação.

Despublicar ou arquivar incrementa a geração/época de publicação e cancela pedidos pendentes correspondentes. Um job atrasado não pode republicar conteúdo removido. Restauração cria uma revisão a publicar explicitamente. Troca de empresa no painel não redireciona jobs já criados.

Preparar embeddings não exige manter locks; ativar conteúdo exige uma última checagem transacional. Essa separação e a ordem estável de bloqueios seguem a revisão feita com a skill de boas práticas de PostgreSQL.

## 7. Recuperação híbrida e isolamento

### Passos de uma consulta

1. O backend resolve sessão, empresa e perfil de recuperação. A ferramenta da Nora recebe somente a consulta.
2. Validar consulta, prazo e cota. Obter seu embedding usando o mesmo perfil compatível dos documentos; aplicar template de consulta próprio quando exigido pelo modelo.
3. Executar busca textual e vetorial sobre a mesma geração autorizada da base, filtrando empresa, publicação e perfil dentro do SQL.
4. Obter inicialmente até 20 candidatos por modalidade. Fundir por Reciprocal Rank Fusion, que combina posições nos rankings, com pesos iguais e constante inicial 60; calibrar no desenvolvimento.
5. Deduplicar por identidade, controlar redundância e selecionar até quatro trechos no orçamento. Preservar partes complementares de procedimentos e desempate estável.
6. Validar novamente empresa e identidades antes de montar a ferramenta/contexto enviado ao modelo.

Esses parâmetros são hipóteses de implementação. RRF e distância vetorial não representam probabilidade de a resposta estar correta. Uma busca vetorial sempre pode encontrar vizinhos mesmo fora do assunto: calibrar critérios de relevância com exemplos sem resposta e cobertura insuficiente, em vez de inventar um limiar universal.

A busca textual usa `tsvector`, configuração de português, pesos para título/keywords/corpo e GIN, com testes para nomes, códigos, negações, acentos e hífens ([PostgreSQL](https://www.postgresql.org/docs/18/textsearch-controls.html)). O pgvector documenta busca híbrida e fusão por RRF ([referência](https://github.com/pgvector/pgvector#hybrid-search)).

### Busca exata e HNSW

Começar com vetores pgvector e busca exata dentro do conjunto filtrado e materializado da empresa. Esse caminho serve de referência de recall e evita escolher um top-k global para depois filtrar no JavaScript.

O pgvector distingue busca exata de aproximada. Filtros em índices aproximados podem reduzir a quantidade de resultados; um índice compartilhado entre empresas pode afetar recall. Sua documentação sugere partições por empresa ou tabelas separadas para esse isolamento ([pgvector: filtros e multitenancy](https://github.com/pgvector/pgvector#filtering)).

Adotar HNSW somente após a referência exata, usando partições por empresa/perfil ou outra organização que comprove a mesma fronteira. Rascunhos e versões inativas permanecem excluídos dos resultados no SQL; avaliar índices sobre projeção ativa para evitar que versões históricas prejudiquem recall. Ajustar busca iterativa quando disponível e, se o limite não preencher os candidatos, fazer busca exata limitada à mesma empresa dentro do prazo. Nunca buscar conteúdo de outra empresa para completar resultados.

Não criar partições com nomes derivados de texto arbitrário do navegador. Provisionamento e manutenção das partições são operações controladas. Medir também a carga causada por outras empresas e a proporção de versões inativas.

### Falhas, cache e prazos

Proposta inicial: falha de embeddings no atendimento retorna falha técnica recuperável. Uma eventual modalidade degradada só textual exige configuração e avaliação próprias; não ativá-la silenciosamente. Rascunhos e arquivos originais nunca viram fallback.

Usar cache de embedding da consulta por empresa + perfil + hash da consulta/template; cache de recuperação também inclui geração da base e estratégia. Histórico e permissões entram na chave de qualquer memória/resposta futura. A identidade da empresa é capturada por requisição.

Embeddings da consulta, SQL, fusão e geração compartilham o prazo global atual de 20 segundos. Evoluir `KnowledgeSearch` para receber cancelamento/prazo e devolver métricas estruturadas. Reservar inicialmente até 3 segundos por busca completa dentro do prazo global, com limite menor para SQL, e ajustar por medição. Não somar vinte segundos novos a cada chamada.

## 8. Nora, fontes e experiência

Adaptar o fluxo compartilhado, mantendo inicialmente até duas buscas e três etapas do gerador. O histórico ajuda a interpretar intenção; fatos vêm das evidências recuperadas da empresa. Instruções inseridas em documentos não alteram ferramentas, perfil ou autorização.

Antes de persistir uma resposta, conferir sessão/conversa, lease, empresa, publicação, conjunto e identidade/hash das fontes. Despublicação ou substituição durante a geração bloqueia a resposta apoiada na fonte invalidada.

Persistir referências estruturadas junto da mensagem para sobreviver à recarga. O widget mostra “Artigos consultados”, sem apresentar isso como verificação de todas as afirmações. O backend resolve links e revalida a fonte ao abrir: despublicada fica indisponível; versão atual diferente é identificada. Arquivos originais permanecem privados. A Central de Ajuda usa o mesmo serviço de recuperação com limites próprios, sem geração de resposta; medir o custo de embedding dessas consultas.

No painel: mostrar progresso/erro/retry de indexação, revisão publicada versus pendente e teste da base publicada com trechos utilizados. Teste administrativo usa autorização, orçamento, cancelamento e revalidação próprios. Trocar empresa limpa a tela e ignora respostas tardias. Teste de rascunhos é uma evolução separada.

RAG completo não implica ativar automaticamente um segundo modelo verificador. Avaliar suporte factual, ausência de evidência e injeção de instruções. Se o gerador não atingir os critérios, tratar o problema de conteúdo, recuperação ou geração e avaliar verificação adicional como experimento separado.

## 9. Módulos previstos

Todos os nomes novos são propostas. Reaproveitar módulos equivalentes que tenham sido criados antes de iniciar a implementação.

| Área | Criar | Modificar/integrar |
| --- | --- | --- |
| Banco e ambiente | Migrações de vector, conjuntos, embeddings e fila; ambiente de teste pgvector | `compose.homologacao.yaml`, `db/migrate.ts` se houver necessidade operacional, provisionamento e helpers de testes |
| Extração/divisão | `knowledge/chunking.ts`, extratores TXT/Markdown e armazenamento privado conforme plano do painel | Validação editorial, `ia/knowledge/repository.ts` e contratos de limites |
| Embeddings | `ia/embeddings/provider.ts`, `profiles.ts`, `local.ts` e simulador; `services/embeddings-local/` com runtime Python e artefatos fixados | Configuração privada, dependências do serviço local e `.env.example` |
| Indexação | `db/knowledge-index.ts`, `db/knowledge-index-jobs.ts`, `knowledge/indexer.ts` | Exports da API e métricas |
| Worker | `apps/worker/src/knowledge.ts` para indexação | `apps/worker/src/index.ts`, `db/worker.ts` para RAG por empresa, scripts raiz e limites dos processos |
| Publicação | `db/knowledge-publication.ts` | `db/admin-knowledge.ts`, `db/admin.ts`, `db/admin-sessions.ts`, `admin-routes.ts`, `db/cli.ts` |
| Busca | `ia/knowledge/hybrid.ts` e seleção de resultados | `db/knowledge.ts`, `ia/knowledge/search.ts`, `context.ts` |
| Geração e auditoria | Validação compartilhada de fontes publicadas | `agents/nora.ts`, `generated-response.ts`, `runtime.ts`, `deadline.ts`, `db/worker.ts`, métricas |
| Contratos/fontes | Contratos de jobs, resultados e referências | `packages/contracts/src/knowledge.ts`, `chat.ts`, `db/store.ts`, `widget-routes.ts` |
| Interface | Componentes de progresso e fontes; teste da base publicada | `KnowledgePage.tsx`, serviços do painel, mensagens/Ajuda do widget |
| Avaliação | Fixtures semânticas e runner de comparação | `scripts/evaluate-nora.mts`, `scripts/lib/nora-quality.mts`, testes de banco/RAG/navegador |

## 10. Entregas e aceite

| Ordem | Entrega | Aceite |
| --- | --- | --- |
| R0 | Concluído | Builds/testes de referência; revisão/dimensão fixadas; extensão real nos testes |
| R1 | Concluído | Cobertura, hashes, identidades e RLS validados; corpus histórico preservado |
| R2 | Concluído para texto/Markdown | Conteúdo revisável; job durável; limites e retry aplicados |
| R3 | Concluído | Vetores reais válidos, lotes curtos e reexecução idempotente |
| R4 | Concluído | Falha mantém versão anterior; job obsoleto não publica; ativação atômica |
| R5 | Concluído | Busca textual/vetorial exata com RRF, isolamento no SQL e prazo próprio |
| R6 | Parcial | Fontes persistem e são revalidadas; teste administrativo dedicado ainda pode evoluir |
| R7 | Pendente | Corpus ampliado, carga de 10.000 artigos, backup/restauração e ativação gradual |

R0/R1 e os contratos com simuladores podem avançar sem contratar APIs. O fluxo completo com embeddings locais depende da homologação do artefato e da capacidade computacional. Preparar primeiro testes de recuperação, depois geração com evidências fixas, e por fim o caminho completo. Testar a inferência com saída de rede externa bloqueada após preparar os pesos.

## 11. Avaliação, consumo e operação

### Qualidade e isolamento

Comparar quatro estratégias no mesmo conjunto: lexical atual, textual SQL, vetorial exata e híbrida. Quando houver HNSW, compará-lo à vetorial exata para medir a perda causada pela aproximação, separada da qualidade do modelo de embeddings.

Manter 24 casos de desenvolvimento e 16 reservados do corpus, adaptando explicitamente expectativas históricas. Acrescentar corpus documental sintético separado, com política de reserva própria: paráfrases em português, nomes/códigos, procedimentos distribuídos, negações, conteúdo contraditório, pergunta sem cobertura, documentos maliciosos e duas empresas com políticas diferentes.

Metas propostas: pelo menos uma evidência relevante entre as quatro selecionadas em 90% das perguntas cobertas; 95% de respostas aprovadas por revisão humana no conjunto reservado; zero cruzamentos de empresa ou publicação com fontes invalidadas nos testes de regressão. Informar numeradores, denominadores, intervalos/limites da amostra e requisitos de procedimento que ficaram sem cobertura.

### Desempenho e falhas

Medir separadamente embedding local da consulta, SQL textual, SQL vetorial, fusão, geração, fila de indexação e ativação. Manter como hipótese p95 de SQL/fusão até 200 ms em 10.000 artigos com dez buscas concorrentes; informar quantidade real de trechos/vetores e ambiente. Inferência local tem latência própria; o atendimento completo continua sujeito aos 20 segundos.

Testar concorrência entre publicação/despublicação, revogação, reindexação, worker atrasado, banco reconectado e troca de empresa. Testar dimensão incorreta, vetor zero, resposta parcial de lote, saturação, modelo ausente, timeout, uso desconhecido, cache aquecido e fila interrompida. Medir planos com `EXPLAIN (ANALYZE, BUFFERS)` e papéis reais, seguindo a revisão de índices/RLS da skill PostgreSQL.

### Custos

Registrar separadamente CPU/RAM/tempo de inferência de indexação e consultas, e tokens/custos do gerador externo e da avaliação. Reservar capacidade antes de agendar lotes; contabilizar novas tentativas. Configurar cotas por empresa e concorrência global, preservando capacidade para consultas de atendimento.

Dimensionar com documentos novos/alterados, sobreposição/metadados, consultas, retries e reindexações. Embeddings locais não têm tarifa por chamada externa, mas consomem infraestrutura. Armazenamento dos pesos/vetores e RAM do modelo/índice entram na estimativa; uma reindexação precisa de espaço para dois conjuntos coexistirem. Os custos Groq continuam separados.

### Migração e operação

Implantar leitores de identidades novas, atualizar todos os escritores, preencher índices antigos por empresa e validar completude antes da ativação. Mudança de modelo gera novo perfil e conjunto; o perfil antigo atende até toda a base necessária estar pronta. Nenhuma comparação cruza perfis durante a troca.

Backfill e rollback são explícitos, idempotentes e registrados. Retorno à busca textual só é permitido se índices/conteúdo forem compatíveis e estiverem completos. Troca de estratégia não acontece silenciosamente após uma falha. Preservar fontes históricas pelo prazo de auditoria; excluir arquivos/vetores/derivados de acordo com retenção definida e pedidos de exclusão.

O migrador atual envolve cada arquivo SQL em transação. Caso a construção de HNSW utilize `CREATE INDEX CONCURRENTLY`, executá-la por procedimento próprio fora dessa transação, com retomada e verificação de índice válido. Não inserir esse comando em uma migração transacional sem adaptar o mecanismo.

Verificar backup/restauração com a extensão e seus dados, monitorar filas/erros/consumo e documentar reindexação. Habilitar gradualmente por empresa após homologação com conteúdo sintético e, depois, conteúdo autorizado.

## 12. Decisões ainda abertas

- Homologar o modelo local proposto, fixar revisão/tokenizer/runtime e medir CPU/RAM/lotes/concorrência antes do schema vetorial final e da implantação.
- Orçamento mensal/por rodada e volume representativo de documentos/consultas.
- Armazenamento privado durável para originais e retenção; escolher antes de entregar upload assíncrono.
- Versão pgvector disponível no banco real e ambiente definitivo de implantação; conferir sem supor que o Compose local representa produção.

Os artefatos locais não enviam documentos a um provedor de embeddings. A implantação em produção continua condicionada às pendências de R7 e às decisões abertas abaixo.
