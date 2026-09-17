> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# Plano de implementação do RAG da Nora

Data: 15/09/2026. Status: proposta de implementação baseada no código local inspecionado nesta data.

> Escopo atualizado: o usuário decidiu incluir pgvector, embeddings e recuperação híbrida. O [plano de RAG completo](plano-pgvector-rag-completo.md) prevalece sobre o adiamento da busca vetorial e detalha a nova ordem de implementação. As metas de isolamento e qualidade deste documento continuam aplicáveis.

> Prioridade atualizada pelo usuário em 15/09/2026: importar documentos e gerenciar a base pelo painel, começando por texto e Markdown; PDF e DOCX ficam para depois. O [plano do painel e da importação](plano-base-conhecimento-painel.md) prevalece sobre a ordem de entrega abaixo e sobre o adiamento da edição pelo painel. Os requisitos de isolamento, avaliação e publicação deste documento continuam aplicáveis.

## 1. Objetivo e direção

Evoluir o RAG existente para um fluxo de suporte que recupere conhecimento publicado da empresa correta, responda de forma útil com base nesse conhecimento e tenha qualidade, latência e consumo mensuráveis.

Requisito explícito do usuário: cada empresa tem contexto próprio e isolado. A recuperação, as configurações específicas, o histórico e qualquer cache ou teste pelo painel devem respeitar essa fronteira; ausência de conteúdo nunca autoriza usar a base de outra empresa. O [plano do painel](plano-base-conhecimento-painel.md#isolamento-obrigatório-do-contexto-por-empresa) detalha as regras e os testes de aceite.

A proposta parte de um único modelo gerador, mantém a busca no backend e evolui a recuperação para busca textual indexada no PostgreSQL. Embeddings e um segundo modelo verificador serão experimentos posteriores, condicionados a falhas medidas. São decisões propostas para esta implementação, não uma aprovação prévia de qualidade do fluxo atual.

O primeiro marco é um RAG operacional via importação administrativa e widget persistente. A gestão de artigos no painel depende da autenticação administrativa e entra depois desse marco. Não é necessário reconstruir o chat, o worker ou a persistência.

## 2. Ponto de partida confirmado

| Componente | Implementação observada | Trabalho restante |
| --- | --- | --- |
| Recuperação local | Normalização, pontuação por título/keywords/conteúdo e filtro por empresa | Medir falhas de recuperação e ranking |
| Recuperação com banco | Carrega todos os artigos publicados da empresa e recria o índice JavaScript a cada busca | Persistir chunks e executar busca/ranking no PostgreSQL |
| Conhecimento | JSON demonstrativo; artigos e versões no banco; importação administrativa com versões imutáveis | Processo editorial, indexação e teste de publicação/despublicação |
| Contexto | Até quatro trechos, 900 caracteres por trecho e 5.000 caracteres no JSON de cada busca | Medir consumo total, diversidade e perda de contexto entre trechos |
| Agente | Histórico de até 12 mensagens, duas buscas e três etapas de geração | Avaliar consultas autossuficientes, negações, mudança de assunto e fundamentação |
| Publicação | `generated-response.ts` publica o texto gerado após controles de entrada, prazo e tamanho | Medir qualidade semântica; esses controles não verificam veracidade |
| Worker | Sessão, empresa, lease, versões das fontes e publicação transacional | Preservar invariantes nas novas migrações e no novo índice |
| Auditoria | Tentativas, referências recuperadas, modelo, prompt, duração e uso | Métricas específicas da recuperação e avaliação reproduzível |
| Avaliação | Corpus de 40 casos, 24 de desenvolvimento e 16 reservados; avaliador legado de três perguntas | Adaptar avaliador para o fluxo atual e executar revisão humana |

Referências de código: [busca](../../../apps/api/src/ia/knowledge/search.ts), [consulta ao banco](../../../apps/api/src/db/knowledge.ts), [contexto](../../../apps/api/src/ia/knowledge/context.ts), [agente](../../../apps/api/src/ia/agents/nora.ts), [geração compartilhada](../../../apps/api/src/ia/generated-response.ts), [worker](../../../apps/api/src/db/worker.ts) e [importação](../../../apps/api/src/db/admin.ts).

O working tree contém alterações não commitadas e mudou desde o diagnóstico anterior. Os erros de testes relatados naquela inspeção não devem ser tratados como falhas atuais sem nova execução. Este plano não executou novamente as suítes.

O [plano de qualidade anterior](plano-qualidade-respostas-nora.md) e o [registro do corpus](../verification/avaliacao-qualidade-nora.md) descrevem também uma implementação com verificador separado, ausente do fluxo atual. Preservar esses resultados como históricos e indicar sua versão. A [investigação da Groq](../verification/investigacao-falhas-verificador-groq.md) registra chamadas reais com HTTP 400 e parecer inconsistente; isso não equivale à avaliação semântica completa do corpus.

## 3. Arquitetura pretendida

```text
Importação administrativa → versões imutáveis → chunks indexados → publicação
                                                   ↓
Mensagem + sessão → worker → agente → busca da empresa → contexto limitado
                               ↑                          ↓
                               └──── até duas buscas ─────┘
                               ↓
                          resposta gerada
                               ↓
           validar sessão, lease e versões das fontes
                               ↓
             mensagem + tentativa + conclusão atômicas
```

A Central de Ajuda usará o mesmo serviço de busca, sem passar pelo modelo. A autorização é resolvida antes da recuperação. O modelo recebe apenas uma ferramenta de consulta, sem poder publicar artigos ou executar ações na conta.

Um modelo gerador não significa uma única chamada ao provedor: o ciclo atual pode realizar até três etapas. O prazo inicial permanece em 20 segundos para o fluxo de geração/busca; tempo na fila e tempo de publicação são medidos separadamente.

## 4. Etapas e critérios de aceite

### R0 — Consolidar a implementação atual

Dependências: nenhuma. Prioridade: imediata.

- [ ] Registrar commit, diff e versões das ferramentas usadas na validação, preservando alterações existentes.
- [ ] Confirmar um único caminho de produção em `runtime.ts` → `generated-response.ts`, compartilhado por serviço e worker. Identificar explicitamente o caminho legado do avaliador.
- [ ] Alinhar testes, fixtures, comentários, exemplos e documentação ao fluxo de geração atual.
- [ ] Corrigir no README a expressão “uma única chamada” e a descrição de sugestões, que atualmente são devolvidas vazias pelo serviço.
- [ ] Validar migrações `002` e `003` em banco novo e atualização de banco existente, preservando auditorias antigas e aceitando o modo `generated`. Não reescrever migrações já aplicadas.
- [ ] Executar tipagem, build, testes de API, corpus e PostgreSQL. Rodar os cenários de widget afetados.

Aceite: comandos reproduzíveis passam no mesmo estado do código; nenhuma referência executável a módulos removidos; documentação distingue o fluxo atual do histórico. A aprovação dessa etapa é técnica, não semântica.

### R1 — Formalizar conhecimento e publicação

Dependência: R0.

- [ ] Validar os cinco artigos demonstrativos com um responsável pelo produto; completar procedimentos apenas com informação confirmada.
- [ ] Estabelecer um responsável e uma data de revisão para o conteúdo, inicialmente em registro editorial versionado.
- [ ] Definir publicação, nova versão, despublicação e retorno a uma versão anterior usando a importação administrativa existente.
- [ ] Testar importação idempotente, recusa de conteúdo diferente na mesma versão, erro de empresa inexistente e comportamento de `draft` sobre artigo já publicado.
- [ ] Documentar que omitir um artigo do arquivo de importação não o despublica automaticamente.
- [ ] Manter conteúdo público por empresa no primeiro marco; permissões por artigo exigirão um desenho próprio antes de receber conhecimento privado por usuário.

Aceite: publicar uma nova versão muda a busca do banco sem reiniciar; despublicar impede novas recuperações; tentativa em curso com versão invalidada não publica resposta; empresas distintas podem usar o mesmo ID sem cruzar conteúdo.

### R2 — Criar avaliação reproduzível e medir a referência

Dependência: R0. A revisão editorial de R1 pode ocorrer em paralelo.

- [ ] Adaptar `scripts/evaluate-nora.mts` para chamar o fluxo compartilhado atual e consumir o corpus.
- [ ] Separar avaliação de recuperação, geração com evidências fixas e fluxo completo com busca real.
- [ ] Implementar resumo sem chamadas externas como padrão, seleção de casos, repetições, concorrência, limite de chamadas e orçamento de tokens. Os parâmetros são novos itens de implementação, não comandos já disponíveis.
- [ ] Reservar o máximo de consumo previsto antes de iniciar cada interação; interromper novas interações quando o limite restante não comportar a reserva. Uso desconhecido permanece identificado e não libera orçamento como se fosse zero.
- [ ] Registrar a versão do corpus, hash dos artigos, prompt, configuração de busca, modelo solicitado/retornado, consultas realmente executadas, evidências entregues e erros.
- [ ] Usar somente dados sintéticos nos relatórios locais com texto integral. Auditoria operacional continua sem copiar perguntas, respostas ou conteúdo bruto do provedor.
- [ ] Criar anotações de recuperação para os casos de desenvolvimento: consulta esperada, fontes relevantes e requisitos de evidência. Não reutilizar automaticamente a lista de evidências esperadas como resultado da busca.
- [ ] Preservar o corpus histórico. Criar uma versão ou adaptação explícita para expectativas exclusivas do verificador removido, com contagem de casos não aplicáveis por variante.
- [ ] Medir a referência lexical atual antes de mudar o ranking. Executar primeiro um lote pequeno após definir o orçamento; ampliar para os 24 casos de desenvolvimento.

Aceite: relatório reproduzível distingue erro de busca, falta de cobertura editorial e erro de geração; falhas técnicas entram no denominador; nenhum gabarito chega ao modelo; os 16 casos reservados não orientam ajustes.

### R3 — Indexar e buscar no PostgreSQL

Dependências: R1 e infraestrutura de medição de R2.

- [ ] Criar migração aditiva para chunks com empresa, artigo, versão do artigo, versão do algoritmo de divisão, índice do trecho, texto exato, hash e documento de busca.
- [ ] Usar chaves e referências compostas por empresa/artigo/versão. Incluir a versão do algoritmo na identidade das novas evidências ou manter algoritmos antigos imutáveis; não reutilizar uma identidade de chunk com outro texto.
- [ ] Gerar chunks uma vez durante a importação. A publicação só aponta para a versão após todos os trechos estarem prontos, na mesma transação para esta escala inicial.
- [ ] Fazer preenchimento retroativo idempotente das versões necessárias e conferir hashes, contagem e cobertura do texto antes de ativar o novo caminho.
- [ ] Implementar busca textual com configuração de português, pesos para título/keywords/corpo, índice GIN e desempate estável. GIN é o tipo preferido pela documentação do PostgreSQL para busca textual. [Referência oficial](https://www.postgresql.org/docs/17/textsearch-indexes.html).
- [ ] Executar filtro de empresa e vínculo à versão publicada no SQL antes do limite de resultados. Aplicar RLS à nova tabela e permissões mínimas ao runtime; testar com o papel real da aplicação, pois proprietários e papéis privilegiados podem contornar RLS. [Referência oficial](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
- [ ] Recuperar inicialmente até 12 candidatos e selecionar até quatro para o contexto. Comparar limite de trechos por artigo e deduplicação sem descartar partes complementares de um procedimento.
- [ ] Avaliar acentos, plurais, códigos do produto, sinônimos e erros de digitação no desenvolvimento. Adicionar trigramas somente se os casos justificarem, com limite de candidatos e métricas separadas.
- [ ] Comparar divisão atual com preservação de listas/procedimentos; alterar tamanho ou sobreposição apenas quando melhorar cobertura dentro do orçamento de contexto.
- [ ] Manter a interface `KnowledgeSearch` ou versioná-la junto dos consumidores. Manter a busca JSON como demonstração, identificando a estratégia nos relatórios.
- [ ] Medir planos de consulta e latência em bases sintéticas de 100, 1.000 e 10.000 artigos, incluindo duas empresas e múltiplas versões.

Aceite: nenhuma reconstrução de toda a base em JavaScript por consulta no modo PostgreSQL; nenhuma fonte de empresa/versão indevida; preenchimento retroativo repetível; recuperação igual ou melhor que a referência nos casos de desenvolvimento, com regressões por categoria explicitadas.

### R4 — Qualificar geração e contexto

Dependências: R2 e R3.

- [ ] Manter histórico para interpretar intenção e negações; fatos do produto precisam vir dos trechos recuperados na interação.
- [ ] Avaliar recuperação de senha, limites/prazos, respostas breves, mudança de tema, cobertura parcial, contradições e instruções maliciosas nos artigos.
- [ ] Manter as duas buscas e três etapas; medir os tokens do prompt, histórico e todos os retornos de ferramenta, não apenas os 5.000 caracteres de um retorno.
- [ ] Versionar mudanças de prompt e seleção de contexto. Ajustar uma variável por experimento para atribuir ganhos e regressões.
- [ ] Distinguir ausência de orientação, pedido de esclarecimento, assunto externo e falha técnica. Não anunciar ausência de conhecimento quando a busca falha.
- [ ] Preservar bloqueios por erro, timeout, texto vazio e resposta excessiva; testar descarte de conclusão tardia mesmo quando o provedor ignora cancelamento.
- [ ] Manter `verified: false` no fluxo de geração direta. Referências recuperadas não devem ser rotuladas como prova de suporte de todas as afirmações.
- [ ] Revisar manualmente respostas com passo extra, condição omitida, preço inventado ou promessa de ação indisponível. Prompt e citações válidas não garantem fundamentação semântica.

Aceite: cumprir as metas de qualidade da seção 5 no desenvolvimento e depois na validação reservada. Se geração direta não atingir as metas, o piloto aguarda o experimento corretivo pertinente: conteúdo, recuperação, prompt ou verificação opcional.

### R5 — Integrar fontes e Central de Ajuda

Dependências: R3; a aprovação de respostas depende de R4.

- [ ] Expor busca e leitura de artigos pela sessão/instalação autorizada, usando o mesmo serviço de conhecimento.
- [ ] Estender os contratos e a persistência necessários para devolver referências estruturadas junto das mensagens, preservando recarga e histórico.
- [ ] Exibir “Artigos consultados” com título e navegação interna; o servidor resolve os IDs e a autorização. Não depender de links inventados no texto do modelo.
- [ ] Na leitura, verificar novamente publicação e permissão. Fonte despublicada exibe indisponibilidade; uma versão histórica não pode ser lida só porque foi citada anteriormente.
- [ ] Quando o artigo tiver mudado, distinguir a versão usada na resposta da versão atual. Não apresentar conteúdo novo como se fosse a evidência antiga.
- [ ] Preservar validação e apresentação segura do conteúdo nos componentes existentes.
- [ ] Tratar edição/publicação pelo painel como entrega dependente de login administrativo, vínculo à empresa e permissões de editor; até lá, manter a importação por CLI.

Aceite: visitante encontra artigo pela Ajuda e acessa as referências da conversa, inclusive após recarga; troca de empresa, ID forjado e despublicação não expõem conteúdo indevido.

### R6 — Operar e liberar o piloto

Dependências: R0–R5 e requisitos operacionais existentes de hospedagem.

- [ ] Medir por empresa e versão de estratégia: busca vazia, candidatos/trechos, latência da busca, chamadas, tokens conhecidos/desconhecidos, duração da geração, espera na fila e publicação.
- [ ] Separar uso de avaliação do atendimento; preservar contabilidade por tentativa e evitar somar os mesmos tokens nas métricas de execução e tentativa.
- [ ] Definir limites por sessão/empresa, reservas antes de agendar e comportamento após limite do provedor. Não habilitar retries ilimitados.
- [ ] Gerar relatório de mediana, p95, erros e revisão humana, com contagens absolutas e limites da amostra.
- [ ] Homologar com duas empresas, navegador, PostgreSQL e modelo real dentro do orçamento definido, incluindo recarga, retry, sessão revogada, versão alterada e worker atrasado.
- [ ] Implantar mudanças de banco de forma aditiva, ativar a nova busca por empresa e registrar a estratégia em cada tentativa.
- [ ] Prever retorno à estratégia lexical anterior mantendo isolamento e dados atuais. Em regressão de geração, suspender a IA da empresa preservando mensagens e estado recuperável; não publicar texto considerado inseguro como fallback.
- [ ] Validar backup/restauração, configuração, limites e observabilidade conforme o [plano operacional](plano-hospedagem-mensagens-historico-ia.md).

Aceite: relatório atende às metas abaixo; recuperação operacional demonstrada; responsável pelo produto aprova conteúdo e qualidade; responsável técnico aprova operação.

## 5. Metas propostas para o primeiro piloto

As metas abaixo são critérios de aceite propostos, não resultados já obtidos. Confirmar o ambiente e o conjunto de carga antes da medição; não relaxar metas depois de observar uma falha sem registrar a decisão.

| Dimensão | Meta e forma de medir |
| --- | --- |
| Isolamento e publicação | 100% dos testes de empresa, sessão, lease, versão e idempotência aprovados |
| Recuperação | Ao menos um trecho relevante entre os quatro entregues em ≥90% das consultas cobertas anotadas; registrar também quantos requisitos de evidência ficaram sem cobertura |
| Fidelidade semântica | ≥95% das respostas do conjunto reservado aprovadas por revisão humana; erro técnico conta como não aprovado |
| Utilidade | ≥90% das perguntas cobertas respondidas adequadamente; recusa genérica não conta como solução |
| Erros críticos conhecidos | Zero publicação de fonte de outra empresa, versão invalidada, procedimento proibido ou ação inventada nos casos de regressão, em três repetições |
| Busca | p95 ≤200 ms na carga de 10.000 artigos, inicialmente com dez buscas concorrentes; registrar hardware, versões e estado do cache |
| Geração | Deadline de 20 segundos respeitado; publicar p50/p95, proporção de timeouts e duração total do chat separadamente |
| Consumo | Todas as tentativas contabilizadas, uso ausente marcado e execução dentro do orçamento definido para a rodada |

Para validação completa, planejar três repetições por caso: 120 interações para 40 casos por variante, com até três chamadas de geração por interação no fluxo atual. O avaliador deve calcular a previsão antes da execução. Amostras pequenas não demonstram garantia geral; informar numeradores e denominadores, inclusive nos subconjuntos cobertos.

## 6. Evoluções condicionais

### Busca semântica com embeddings

Gatilho: falhas recorrentes em paráfrases ou vocabulário diferente, mesmo após revisão editorial e melhoria da busca textual.

Experimento: adicionar embeddings aos chunks versionados, comparar recuperação textual, vetorial e combinação das duas com o mesmo corpus. Incluir custo de indexação, tempo de atualização, isolamento antes do top-k, dimensões/modelo versionados e reindexação. Promover somente com ganho medido e operação compatível com o orçamento. Reranking por modelo é outro experimento separado, se a ordenação continuar sendo o gargalo.

### Verificação por outro modelo

Gatilho: recuperação adequada, mas persistência de afirmações sem suporte ou passos extras que impeçam R4.

Experimento: avaliar a verificação fora do caminho de publicação primeiro. Usar contrato simples com referências e trechos literais; posições de caracteres, quando necessárias, são derivadas e validadas pelo servidor. Medir aprovações indevidas, rejeições de respostas úteis, falhas de contrato, latência e tokens. Investigar separadamente HTTP 400 e parecer inválido já registrados. Só inserir no fluxo após definir prazo total, resposta a falhas e ganho líquido de qualidade.

### Novas fontes e painel editorial

PDF, crawler, OCR, conectores e painel de edição ficam para entregas posteriores. Cada fonte precisa de origem, autorização, extração, revisão, versionamento e remoção rastreáveis antes de entrar na base publicada. A autenticação administrativa é dependência explícita do painel.

## 7. Ordem de entrega e próximos passos

Sequência: R0 → R1/R2 → R3 → R4/R5 → R6. A separação indica trabalhos independentes, não exige execução com múltiplos agentes.

| Entrega revisável | Conteúdo principal |
| --- | --- |
| 1 | Consolidar fluxo atual, migrações, testes e documentação (R0) |
| 2 | Publicação editorial e avaliador com referência medida (R1–R2) |
| 3 | Chunks persistidos, preenchimento retroativo e busca SQL comparada (R3) |
| 4 | Ajustes de contexto/geração com relatório de qualidade (R4) |
| 5 | Fontes e Ajuda integradas ao widget (R5) |
| 6 | Métricas, homologação, ativação gradual e retorno operacional (R6) |

Primeira implementação concreta: concluir R0 e entregar o avaliador sem chamadas externas de R2. Isso estabelece um estado reproduzível e uma medição antes de alterar recuperação ou consumo do provedor. Estimar esforço após R0, considerando o resultado das suítes e a disponibilidade da revisão de produto.

Este documento entrega o plano. Migrações, código de busca, mudanças no widget, chamadas reais e implantação pertencem às etapas futuras descritas acima.
