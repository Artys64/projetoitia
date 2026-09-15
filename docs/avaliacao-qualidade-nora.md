# Corpus de qualidade da Nora

Data: 14/09/2026. Entregas: Etapas 1–3 do [plano de qualidade](plano-qualidade-respostas-nora.md).

O [corpus versionado](../tests/fixtures/nora-quality.json) contém 40 casos sintéticos, com 24 destinados ao desenvolvimento e 16 reservados para validação. Há 80 rascunhos anotados: um correto e um incorreto por caso. As anotações são expectativas para a avaliação futura, não resultados de um verificador já executado.

## Referência congelada

A referência registra o commit `afef0e382a7a944e4e1317cf1bfc7cf77647b7b1`, o texto integral e o hash do prompt `rag-agent-v3`, o hash do gerador, o modelo Groq `openai/gpt-oss-20b` e os parâmetros de geração. Os cinco artigos demonstrativos estão copiados integralmente, com empresa, versão e hash do conjunto. Não há dados de conversas de clientes.

Os parâmetros registrados são temperatura 0, até 1.200 tokens de saída por etapa, esforço de raciocínio `medium`, chamadas paralelas desativadas, duas buscas, três etapas, quatro trechos/5.000 caracteres por retorno e timeout de 20 segundos. A referência não presume um modelo ou versão de prompt para o futuro verificador.

Os artigos adicionais são explicitamente sintéticos: exportação com uma instrução maliciosa, senha de outra empresa e versão 2 com prazo diferente. Eles existem apenas no corpus; não alteram a base de demonstração do produto.

## Estrutura dos casos

| Campo | Uso |
|---|---|
| `companyId`, `history`, `question` | Empresa fixada pelo servidor, histórico anterior e pergunta atual separada. |
| `availableArticles` | Snapshots disponíveis no cenário; podem incluir outra empresa para exercitar isolamento. |
| `retrievedEvidence` | Trechos exatos entregues ao modelo no teste isolado, após seleção de contexto. |
| `acceptedSources` | Fontes que podem sustentar a resposta publicada; não obriga citar todas. |
| `allowedClaims`, `requiredBehaviors`, `forbiddenClaims` | Rubrica semântica de permissões, requisitos de utilidade e erros proibidos. |
| `acceptableResponseModes` | Modos aceitáveis no fluxo completo; uma aprovação ainda precisa satisfazer a rubrica. |
| `drafts` | Entradas para testar o verificador isoladamente, com decisão e motivos esperados. |
| `fault`, `reviewNote` | Falhas a injetar no fluxo completo e instruções para interpretar o cenário. |

Cada evidência referencia artigo, empresa, versão e índice do chunk, com texto literal conferido contra o snapshot. O histórico explica intenção e negações; ele não é evidência do produto. Uma fonte recuperada pode não estar entre as fontes aceitas, como no caso de um artigo de senha recuperado para uma dúvida sobre exclusão de conta.

O futuro teste isolado usará `retrievedEvidence` diretamente. A avaliação completa de geração deverá buscar em `availableArticles`, com a empresa definida no servidor, e registrar quais trechos realmente foram entregues. Não deve substituir silenciosamente os resultados reais da busca pelos trechos esperados do fixture.

Há dois cenários de falha: referência forjada no parecer e despublicação da fonte antes do commit. Seus rascunhos corretos podem ser aprovados semanticamente antes da falha; o fluxo completo deve terminar em erro técnico recuperável. A anotação do rascunho não autoriza sua publicação após a falha.

## Divisão e revisão

| Categoria | Desenvolvimento | Validação reservada |
|---|---:|---:|
| Perguntas cobertas | 4 | 2 |
| Cobertura parcial | 4 | 2 |
| Continuidade | 4 | 2 |
| Produto sem cobertura | 2 | 2 |
| Fora do escopo | 2 | 2 |
| Social e intenção mista | 2 | 2 |
| Contradições e condições | 2 | 2 |
| Injeção, fontes e isolamento | 4 | 2 |
| Total | 24 | 16 |

Os casos de senha com passo extra e seguro para a Antártida estão no desenvolvimento e remetem às falhas registradas. O caso de senha contém uma resposta quase toda correta com apenas a orientação adicional de abrir o link e criar uma nova senha.

Use apenas o desenvolvimento para ajustar o verificador. Se uma falha do conjunto reservado orientar uma alteração, registre o caso, a rodada e a alteração e acrescente casos novos reservados antes da próxima rodada. A inspeção de integridade não avalia respostas do modelo e não consome a reserva semântica.

Não compare paráfrases por palavras-chave ou igualdade literal. A revisão humana deve conferir a rubrica e as fontes, inclusive condições omitidas e passos extras. Para os modos de mensagem fixa, use o texto exato de `fixedResponses`. Não contar recusa genérica como resposta útil para uma pergunta coberta. Falhas técnicas permanecem no denominador e nunca comprovam ausência de informação.

## Comandos locais

```sh
npm run quality:corpus
npm run quality:corpus -- --split=validation
npm run quality:corpus -- --split=all
npm run test:quality
npm run check:quality
```

O comando de inspeção seleciona desenvolvimento por padrão, valida referências e contagens e mostra os parâmetros congelados e eventuais divergências do código atual. Ele não importa o cliente Groq, não usa chaves, não chama IA e não grava relatório de qualidade. A seleção explícita de validação exibe somente o resumo estrutural, sem imprimir perguntas ou gabaritos.

Os testes do corpus verificam integridade, isolamento das evidências, versões ativas, rubricas obrigatórias, divisão e bloqueio esperado nos fixtures de falha. Eles fazem parte de `npm test`; a tipagem dos novos scripts faz parte de `npm run check`. Esses testes de integridade não exercitam o worker nem um verificador de respostas; as etapas seguintes acrescentam suítes próprias. Uma divergência futura entre o código e a referência deve ser registrada na rodada de avaliação; não reescreva o snapshot histórico para escondê-la.

Verificação da Etapa 1: `npm test` passou com 25 testes de API, 3 de contratos e 8 de integridade do corpus (36 no total). A tipagem dos três novos arquivos TypeScript passou. A inspeção de desenvolvimento e de todos os casos confirmou as contagens e a correspondência dos artigos, prompt e gerador com a referência. Nenhuma avaliação semântica foi executada.

O script legado `scripts/evaluate-nora.mts` continua fazendo chamadas reais e ainda não consome este corpus. Sua adaptação com limites de consumo está prevista na Etapa 4. Nesta entrega não houve execução desse script, chamadas pagas ou implantação.

## Etapa 2 — Verificador e política com provedor simulado

A entrada [generateVerifiedNoraResponse](../apps/api/src/ia/verified-response.ts) executa geração e verificação separadas e devolve uma união discriminada: `status: publish` com o texto final e suas fontes, ou `status: blocked` com um código técnico. A saída bloqueada não contém texto do rascunho. Na entrega da Etapa 2, essa entrada ainda não estava conectada aos consumidores; a integração e a persistência da auditoria foram acrescentadas na Etapa 3, descrita abaixo.

[generateNoraDraft](../apps/api/src/ia/agents/nora.ts) preserva os trechos realmente incluídos nos retornos da ferramenta. A identidade inclui empresa, artigo, versão e chunk. Repetições são deduplicadas; versões diferentes ficam separadas; texto divergente para a mesma identidade e fontes de outra empresa causam falha. O contexto e as evidências são cópias independentes dos objetos da busca. Os snapshots de evidência retornados são imutáveis.

O prompt [nora-verification-v1](../apps/api/src/ia/prompts/verification.ts) recebe pergunta atual, histórico, rascunho completo e evidências em um payload de dados. Comandos nos artigos ou mensagens não alteram a política do sistema. O verificador usa `generateText` com `Output.object`, conforme a documentação e o código do AI SDK instalado. Não recebe ferramentas, gabaritos ou uma função de reescrita. O modelo deve ser fornecido explicitamente pelo chamador; nesta entrega foram usados apenas modelos simulados.

O [contrato](../apps/api/src/ia/verification.ts) inclui decisão, motivos enumerados, intenção, cobertura, segmentos e uma eventual referência para alternativa literal. Os segmentos particionam o rascunho inteiro por índices UTF-16, com fim exclusivo, sem lacunas nem sobreposição. Cada passagem precisa coincidir literalmente com o rascunho; os segmentos factuais aprovados precisam de fonte existente e citação literal da evidência. Campos desconhecidos, referências forjadas, decisão incerta ou JSON inválido bloqueiam a resposta.

Limites do contrato: 8.000 caracteres no rascunho, até 12 mensagens, oito evidências, 64 segmentos e seis motivos. O verificador tem temperatura 0, limite de 3.000 tokens de saída e uma chamada por tentativa. Retorno terminado por limite de tokens também é bloqueado. Retries automáticos do SDK estão desativados nas duas etapas, preservando o máximo de três chamadas de geração mais uma de verificação.

Uma aprovação devolve exatamente o texto revisado. Uma rejeição só usa o trecho integral explicitamente indicado e validado, sem prefixo, complemento ou seleção automática do primeiro resultado. As demais saídas são mensagens fixas de escopo, ausência confirmada de orientação ou esclarecimento. Se houver orientação relevante mas nenhuma alternativa segura, o resultado é `no_safe_alternative`; não se afirma que a base não tem informação.

Os códigos `invalid_input`, `invalid_verdict`, `uncertain`, `no_safe_alternative`, `unavailable`, `timeout` e `insufficient_time` bloqueiam o texto na verificação. Falhas anteriores são diferenciadas como `search_failed` ou `generation_failed`, salvo códigos específicos de prazo. Na Etapa 3, esses resultados passaram a alimentar os estados recuperáveis do chat, preservando a pergunta.

O prazo absoluto é compartilhado e limitado a 20 segundos, inclusive se o chamador fornecer um limite maior. A geração recebe até 14 segundos; a verificação exige cinco segundos disponíveis e um segundo de margem. Um prazo menor reduz o tempo da geração para preservar a reserva. Antes de cada nova etapa de geração é exigido pelo menos um segundo restante. Timeout aborta a chamada e descarta resultados tardios mesmo se o provedor ignorar o sinal de cancelamento.

O retorno contém auditoria com versões de prompt, modelo informado pelo provedor, duração, decisão, motivos e referências das fontes recuperadas e de suporte. Tokens de geração e verificação são somados, preservando detalhes de cache e raciocínio quando disponíveis. Saída estruturada inválida preserva o uso informado pelo SDK. Em falhas de geração, a auditoria conserva o uso das etapas concluídas com `completed: false`; o total da tentativa permanece desconhecido. Uso ausente nunca é convertido em zero. Rascunho, histórico, citações do parecer e corpos brutos de erros não entram na auditoria.

Os testes em [nora-verification.test.ts](../apps/api/src/nora-verification.test.ts) fornecem pareceres simulados para testar contratos, decisão e limites. Eles não medem a capacidade semântica de um modelo real. A cobertura integral por segmentos impede omissões estruturais, mas um modelo ainda pode classificar incorretamente uma frase ou atribuir suporte semântico indevido a uma citação real. A avaliação humana da Etapa 4 continua necessária.

O gerador mudou na Etapa 2; por isso `npm run quality:corpus` deve informar `currentMatchesBaseline.generator: false`. O snapshot histórico, os artigos e o prompt `rag-agent-v3` foram preservados. Não houve avaliação semântica dos 16 casos reservados.

Verificação da Etapa 2: `npm test` passou com 53 testes de API (28 novos para verificação), 3 de contratos e 8 do corpus, totalizando 64. `npm run check` passou para todos os workspaces e scripts do corpus, incluindo builds de contratos e API. Os testes novos também passaram em tipagem isolada. Não foram executados testes de banco ou navegador nesta etapa; os cenários da integração persistente pertencem à Etapa 3.

## Etapa 3 — Integração, auditoria e publicação transacional

[createVerifiedGenerator](../apps/api/src/ia/runtime.ts) conecta o worker e o serviço de desenvolvimento ao mesmo fluxo. `GROQ_VERIFICATION_MODEL` permite escolher o verificador; quando ausente, usa o modelo de geração. A entrada legada sem verificação fica restrita ao avaliador de referência. Sugestões dos artigos não são publicadas, pois não passaram pelo parecer. O modo sem LLM identifica explicitamente sua saída como demonstração sem verificação de pertinência.

A [migração 002](../apps/api/migrations/002_response_verification.sql) acrescenta `ai_run_attempts`, isolada por empresa com RLS e sem permissão de exclusão para o runtime. Cada tentativa registra lease, estado, modelo e prompt de cada etapa quando disponíveis, decisão, motivos, fontes, duração e uso. O rascunho rejeitado e as citações internas do parecer não são persistidos. Uma resposta tardia só pode completar a auditoria de sua própria tentativa expirada, sem sobrescrever a tentativa atual.

Antes da geração e da publicação, o worker confere a autorização e a propriedade da lease. A transação final revalida as versões de todas as fontes recuperadas e de suporte, inclusive para alternativas literais ou fixas. Bloqueios de linha impedem alterações concorrentes; o `INSERT` também confere o relógio real para detectar expiração da sessão ou lease durante a espera por bloqueios. Mensagem final, auditoria e conclusão da execução são confirmadas atomicamente.

Falhas do verificador não publicam o rascunho: o chat persistente preserva a pergunta e permite nova tentativa dentro dos limites existentes. O endpoint de desenvolvimento responde com erro técnico seguro. As métricas mantêm os campos legados da última tentativa e acrescentam totais de todas as tentativas, quantidade com uso desconhecido e distribuição de decisões. Esses totais não devem ser somados aos campos legados.

Os novos testes usam PostgreSQL real e modelos simulados passando pelas ferramentas, geração, verificação e política reais. Cobrem alternativa literal, escopo, contrato inválido, incerteza, retry idempotente, isolamento da auditoria, fontes despublicadas, sessão revogada/expirada, instalação desativada, conversa encerrada e workers atrasados. Pareceres simulados são fixtures escritos para o teste, não um avaliador semântico.

Verificação da Etapa 3: `npm run check` e `npm run build` passaram. `npm test` aprovou 59 testes de API, 3 de contratos e 8 do corpus (70 no total). `npm run test:db` aprovou 25 testes, incluindo dois agregadores. O chat passou nos 36 cenários de Chromium, Firefox e WebKit, em desktop e móvel, incluindo recarga da alternativa literal e recuperação após falha do verificador. Os novos arquivos de teste também passaram em tipagem isolada. Comandos, ambiente e ajustes de teste estão na [verificação do chat](verificacao-chat-persistente.md).

Nenhuma chamada paga, migração em banco remoto ou implantação foi executada nesta etapa. O conjunto reservado continua sem avaliação semântica. A Etapa 4 ainda exige limites de consumo no avaliador, orçamento definido e revisão humana; a integração técnica não aprova a qualidade para o piloto.
