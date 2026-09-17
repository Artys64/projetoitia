> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# Plano de construção — Central de suporte incorporada

Data do plano: 09/09/2026  
Documento de origem: `MVP_REFERENCIA_CLAUDE.md`

Atualização de escopo em 11/09/2026: a primeira entrega deve provar instalação por snippet em página externa, empresa correta e abertura, fechamento e navegação sem prejudicar o host. O detalhamento e os critérios de aceite vigentes estão na seção 9 do [plano de implementação](PLANO_IMPLEMENTACAO_SDD.md). Histórico, atendimento humano e IA entram depois. As semanas abaixo permanecem estimativas históricas, a reavaliar após essa prova.

## 1. Resultado esperado

Entregar um produto multiempresa instalável em sites externos que permita ao visitante:

1. abrir uma central de suporte sem sair do produto;
2. pesquisar e ler conteúdo publicado pela empresa;
3. conversar com uma IA limitada a esse conteúdo;
4. pedir atendimento humano sem perder o histórico;
5. fechar, retornar e encontrar a conversa atualizada.

O administrador da empresa deve conseguir configurar a central, manter a base de conhecimento, testar a IA e tratar conversas encaminhadas.

O MVP estará pronto para piloto quando os critérios da seção 11 forem comprovados em ambiente de homologação com duas empresas distintas e dois usuários por empresa.

## 2. Premissas de planejamento

- Produto novo, sem código legado no repositório.
- Equipe de referência para estimativa: duas pessoas de engenharia em tempo integral, com apoio parcial de produto/design.
- Prazo-alvo: **7 semanas de construção + 1 semana de estabilização e preparação do piloto**.
- Com uma pessoa de engenharia, considerar aproximadamente **11 a 14 semanas**.
- Atendimento humano será assíncrono e feito pelo próprio administrador no piloto.
- O widget terá atualização quase em tempo real, mas WebSocket não é obrigatório. Polling curto ou SSE é suficiente no MVP.
- A primeira versão aceitará cadastro manual de artigos e FAQs; crawler e importadores ficam fora.
- A busca começa com recursos do PostgreSQL. Banco vetorial só entra se os testes mostrarem necessidade.
- Um único provedor de modelo será implementado, atrás de uma interface interna para permitir troca futura.
- E-mail de notificação e resposta por e-mail não fazem parte da entrega inicial.

## 3. Recorte funcional

### Incluído

- Snippet de instalação e painel flutuante responsivo.
- Áreas Início, Mensagens, Conversa e Ajuda.
- Personalização de nome, saudação, cor, links e cartão opcional de status.
- Base de conhecimento com rascunho/publicado, categorias e busca.
- Respostas de IA com fontes e comportamento explícito para falta de cobertura.
- Conversas persistentes e mensagens não lidas.
- Transferência IA → humano com resumo e histórico.
- Caixa de entrada administrativa com resposta e resolução.
- Métricas operacionais básicas, feedback, custo e erros.
- Autenticação de administradores, identidade opcional do visitante e isolamento multiempresa.

### Excluído

- Ações transacionais em sistemas externos.
- Omnichannel, resposta por e-mail e notificações avançadas.
- Departamentos, filas, SLA, distribuição e permissões complexas.
- Crawler geral, documentos complexos e múltiplos agentes/modelos.
- Monitoramento próprio de disponibilidade.
- Aplicativos móveis nativos.

## 4. Arquitetura proposta

### Componentes

| Componente | Responsabilidade |
|---|---|
| Aplicação administrativa | Configuração, conhecimento, conversas, teste da IA e instalação |
| Widget incorporável | Início, ajuda, mensagens e conversa dentro de um `iframe` isolado |
| API | Autorização, regras de negócio, mensagens, busca, IA, métricas e configuração pública |
| Worker | Geração de resposta, resumo de transferência e tarefas assíncronas |
| PostgreSQL | Dados transacionais, busca textual, auditoria e isolamento por `tenant_id` |
| Armazenamento de eventos | Pode começar no próprio PostgreSQL; registra custo, feedback, erros e mudanças de estado |
| Provedor de IA | Geração de respostas apenas com o contexto recuperado da base publicada |

### Decisões recomendadas

- **Monorepo TypeScript** para compartilhar tipos e regras entre painel, API e widget.
- **Widget em `iframe` servido pelo produto** para evitar conflito de CSS, reduzir superfície de XSS e permitir atualização sem o cliente trocar o snippet.
- **Snippet mínimo** com identificador público da empresa, origem permitida e método opcional de identificação.
- **PostgreSQL com busca textual e trigramas** no primeiro ciclo. A mesma consulta deve alimentar Ajuda e o contexto da IA.
- **Processamento assíncrono da IA** para permitir repetição controlada, timeout, medição de custo e proteção contra resposta duplicada.
- **SSE ou polling adaptativo** para novas mensagens. Escolher após um spike curto, priorizando operação simples.
- **Observabilidade desde o início** com logs estruturados contendo `request_id`, `tenant_id`, `conversation_id` e código de erro, nunca o conteúdo sensível completo.

### Estrutura sugerida do repositório

```text
apps/
  admin/          painel administrativo
  widget/         interface incorporável e snippet loader
  api/            API HTTP e callbacks internos
  worker/         tarefas assíncronas
packages/
  database/       schema, migrações e acesso aos dados
  contracts/      tipos e validações compartilhados
  ai/             recuperação, prompts e provedor
  ui/             tokens e componentes reutilizáveis
  telemetry/      logs, métricas e eventos
```

## 5. Identidade, sessão e isolamento

Identidade e sessão de visitantes devem ser validadas antes de conectar histórico e atendimento humano. A primeira entrega valida somente instalação, configuração pública por empresa e integração com o host.

### Administrador

- Autenticação no servidor.
- Associação explícita entre usuário administrativo e empresa.
- Toda consulta recebe o `tenant_id` da sessão validada; nunca do corpo enviado pelo navegador.
- No piloto, um papel `admin` é suficiente.

### Visitante anônimo

- O widget cria um segredo aleatório de sessão, armazenado localmente no contexto do widget.
- O servidor guarda apenas uma representação segura desse segredo e associa as conversas àquela sessão e empresa.
- Recarregar a página ou reabrir o widget recupera o histórico no mesmo navegador.
- Trocar de navegador/dispositivo não recupera conversas anônimas no MVP.

### Visitante identificado

- A aplicação cliente gera, no próprio backend, uma asserção assinada de curta duração contendo identificador estável do usuário e empresa.
- Nome e e-mail enviados apenas pelo navegador são tratados como apresentação, não como prova de identidade.
- O logout da aplicação hospedeira chama a API pública do widget para limpar a sessão local; tokens expirados deixam de recuperar o histórico autenticado.

### Controles obrigatórios

- Lista de domínios permitidos por empresa.
- CORS restrito e validação do `origin` também no servidor.
- Identificador público de instalação separado de qualquer segredo.
- Rate limit por empresa, IP, sessão e operação de IA.
- Consultas sempre filtradas por empresa; preferencialmente reforçadas por Row Level Security.
- Testes automatizados negativos entre empresas e entre participantes de uma conversa.
- Sanitização de Markdown/HTML e política de links seguros no conteúdo e nas respostas.
- Registro de auditoria para publicação, resposta humana, transferência, resolução e alterações de configuração.

## 6. Modelo de dados mínimo

| Entidade | Campos essenciais |
|---|---|
| `tenants` | id, nome, status, configurações visuais, expectativa de resposta |
| `tenant_domains` | tenant_id, domínio, verificado, ativo |
| `admin_users` / `memberships` | usuário, tenant_id, papel |
| `visitor_identities` | tenant_id, external_user_id opcional, dados de apresentação |
| `visitor_sessions` | tenant_id, visitor_id, hash do segredo, expiração, encerrada_em |
| `categories` | tenant_id, nome, ordem, publicado |
| `articles` | tenant_id, categoria, título, slug, corpo, estado, versão, publicado_em |
| `conversations` | tenant_id, visitante, estado, canal atual, assunto, resumo, timestamps |
| `conversation_participants` | conversa, identidade/administrador, tipo |
| `messages` | conversa, autor, tipo, corpo, fontes, custo, criada_em |
| `message_reads` | mensagem/conversa, participante, lida_em |
| `conversation_events` | conversa, evento, ator, metadados, criada_em |
| `feedback` | tenant_id, conversa/mensagem/artigo, nota, comentário |
| `ai_runs` | tenant_id, conversa, modelo, tokens, custo, duração, resultado, erro |
| `audit_logs` | tenant_id, ator, ação, alvo, metadados seguros, criada_em |

Estados iniciais da conversa:

```text
ai_active → waiting_human → human_active → resolved
     └──────────────→ resolved
resolved → reopened → ai_active ou waiting_human
```

Regras:

- Em `waiting_human` e `human_active`, a IA não envia respostas automáticas.
- `resolved` só ocorre por ação explícita do visitante ou administrador; inatividade gera resultado `unknown`, não resolução.
- Toda mudança de estado é validada no servidor e registrada como evento.

## 7. Contratos principais da API

Os nomes podem mudar, mas os limites de responsabilidade devem permanecer.

| Área | Operações mínimas |
|---|---|
| Instalação | obter configuração pública, iniciar/encerrar sessão, validar identidade |
| Conhecimento | listar, criar, editar, publicar/despublicar artigos e categorias |
| Busca | pesquisar somente conteúdo publicado da empresa |
| Conversas do visitante | listar próprias conversas, abrir, enviar mensagem, marcar leitura, pedir humano, reabrir |
| Caixa de entrada | listar por estado, abrir histórico, responder, assumir, resolver |
| IA | criar execução, consultar resultado, registrar fontes, custo e falha |
| Métricas | resumo de volume, cobertura, transferências, feedback, custo e erros |
| Configuração | identidade visual, links, status, domínios, expectativa de resposta, ativação |

Todas as escritas de mensagem precisam de uma chave de idempotência para evitar duplicação em repetição de rede.

## 8. Plano de execução

### Fase 0 — Primeira entrega: integração externa navegável

**Objetivo:** provar que uma página externa instala o snippet, abre o widget da empresa correta e permite abrir, fechar e navegar sem prejudicar a página hospedeira.

- Reaproveitar o monorepo e separar loader e widget do painel administrativo.
- Instalar snippet e iframe cross-origin em página externa com controles e estilos próprios.
- Associar duas instalações de teste a configurações públicas distintas e validar origens permitidas.
- Implementar Início, Mensagens e Ajuda navegáveis, com estados locais e conteúdo demonstrativo quando necessário.
- Provar abertura, fechamento, teclado, retorno de foco, rolagem, responsividade e ausência de interceptação de cliques fora da área visível.
- Validar handshake, falhas de carregamento e impacto do loader; registrar evidências conforme o aceite de P1 no plano de implementação.

**Saída:** snippet instalado em página externa demonstra todos os critérios de P1. Sem dependência de histórico, sessão de visitante, atendimento humano ou IA.

### Fase 1 — Widget, configuração e ajuda (semana 2)

**Objetivo:** entregar o primeiro fluxo vertical sem IA.

- Navegação Início, Mensagens e Ajuda com barra inferior fixa.
- Abrir/fechar, foco, teclado, rolagem, movimento reduzido e responsividade.
- Painel de configuração: nome, saudação, cor, links e cartão de status.
- CRUD de categorias e artigos com rascunho/publicado.
- Busca textual, resultados, leitura interna e estados vazio/erro.
- Tela de Instalação com snippet, domínio e ativação.
- Fundação persistente multiempresa, migrações e autenticação administrativa, após a prova externa.

A navegação e a integração já demonstradas na Fase 0 são reaproveitadas; esta fase conecta configuração e conhecimento reais.

**Saída:** empresa personaliza, publica um artigo, instala o widget e o visitante encontra e lê o conteúdo.

### Fase 2 — Conversa persistente e atendimento humano (semanas 3 e 4)

**Objetivo:** comprovar continuidade ponta a ponta antes de adicionar IA.

- Validar sessão anônima, identificação assinada, logout e limitações de armazenamento nos navegadores-alvo.
- Definir o transporte de atualizações conforme a decisão registrada no plano de implementação.
- Criação, listagem e reabertura de conversas.
- Envio, ordenação, idempotência e persistência de mensagens.
- Autores identificados visualmente: visitante, IA e atendente.
- Estado de leitura e contadores de não lidas.
- Caixa de entrada administrativa com filtros mínimos: pendente, em atendimento e resolvida.
- Abrir histórico, assumir, responder, resolver e reabrir.
- Contexto mínimo da página: URL, título, horário e dados técnicos permitidos.
- Atualização por SSE/polling e tratamento de reconexão.
- Testes de concorrência simples e de autorização por participante.

**Saída:** visitante envia uma mensagem; administrador responde; o visitante fecha, retorna e lê a resposta na mesma conversa.

### Fase 3 — IA ancorada no conhecimento (semana 5)

**Objetivo:** responder com conteúdo publicado sem fabricar cobertura.

- Pipeline: normalizar pergunta → buscar conteúdo → montar contexto → gerar → validar → persistir.
- Prompt com proibição de inventar fatos e obrigação de declarar insuficiência de contexto.
- Citações clicáveis para artigos usados.
- Pergunta de esclarecimento quando houver ambiguidade recuperável.
- Limites de contexto, timeout, repetição controlada e fallback de erro.
- Tela Testar IA sem misturar conversas de teste com métricas de visitantes.
- Avaliações fixas com perguntas cobertas, não cobertas, ambíguas e adversariais.
- Registro de latência, tokens, custo, fontes e resultado.

**Saída:** conjunto de avaliação demonstra respostas corretas e recusa adequada nas perguntas não cobertas.

### Fase 4 — Transferência e operação (semana 6)

**Objetivo:** integrar IA e humano como um único atendimento.

- Botão “Falar com uma pessoa” e encaminhamento por falta de cobertura/erro definido.
- Geração de resumo factual, separada do histórico original.
- Estado “Aguardando equipe” com expectativa de resposta configurada.
- Bloqueio transacional da resposta automática da IA após transferência.
- Retomada e resolução com histórico preservado.
- Feedback simples após resolução.
- Lista de dúvidas sem resposta e visão básica de custo, erros e feedback.

**Saída:** IA atende, transfere e para de responder; administrador recebe resumo e histórico e continua na mesma conversa.

### Fase 5 — Segurança, qualidade e piloto (semanas 7 e 8)

**Objetivo:** provar isolamento, confiabilidade e capacidade de operar o piloto.

- Revisão das fronteiras de autorização e ameaça do widget incorporado.
- Testes de isolamento com matriz de duas empresas × dois visitantes × dois administradores.
- Testes E2E dos critérios de piloto em página externa real.
- Acessibilidade: teclado, foco, rótulos, contraste, leitura por tecnologia assistiva e movimento reduzido.
- Desempenho: orçamento do loader, tempo de abertura, paginação e limites de payload.
- Proteção contra abuso, prompt injection por conteúdo/usuário e links inseguros.
- Dashboards e alertas mínimos para taxa de erro, fila parada, latência e custo.
- Política de retenção inicial, exportação operacional e procedimento manual de exclusão.
- Runbook de incidentes, suporte ao piloto, onboarding e formulário de acompanhamento.
- Correções encontradas no ensaio com empresas fictícias antes de habilitar clientes reais.

**Saída:** checklist de piloto aprovado e ambiente de produção observável, recuperável e documentado.

## 9. Ordem do backlog por fatias verticais

| Prioridade | História demonstrável | Dependências |
|---|---|---|
| P0 — primeira entrega | Página externa instala snippet e abre, fecha e navega no widget da empresa correta sem prejudicar o host | Configuração pública de duas instalações, domínio e protocolo; sem sessão de visitante |
| P0 | Empresa é criada e administrador entra apenas no próprio espaço | Prova externa, fundação persistente |
| P0 | Administrador publica artigo e visitante o encontra | Conhecimento, busca |
| P0 | Visitante inicia conversa e a recupera após recarregar | Sessão, conversa |
| P0 | Administrador responde e visitante vê mensagem não lida | Caixa de entrada, atualização |
| P0 | IA responde com fonte a uma pergunta coberta | Busca, worker, provedor |
| P0 | IA admite falta de cobertura | Avaliação, política de resposta |
| P0 | Visitante pede humano e IA deixa de responder | Máquina de estados, transferência |
| P0 | Administrador resolve e coleta feedback | Conversa, feedback |
| P0 | Testes provam isolamento entre empresas e participantes | Autorização completa |
| P1 | Cartão de status manual ou por fonte configurada | Configuração |
| P1 | Lista de dúvidas não resolvidas e custos | Eventos, IA |
| P1 | Identificação assinada personaliza saudação e histórico | Integração do cliente |
| P2 | Notificação por e-mail | Pós-MVP |

Uma história P0 só está concluída quando possui estados de carregamento, vazio e erro; autorização; telemetria; teste automatizado; e instrução operacional quando aplicável.

## 10. Estratégia de testes

### Automatizados

- **Unidade:** máquina de estados, autorização, seleção de conteúdo, cálculo de não lidas e custo.
- **Integração:** API + banco para isolamento por empresa, sessões, publicação, busca e idempotência.
- **Contrato:** snippet/widget/API e formato das respostas do provedor de IA.
- **E2E:** instalação externa, ajuda, conversa, transferência, resposta humana, reabertura e logout.
- **Avaliação da IA:** conjunto versionado de perguntas com critérios de cobertura, fidelidade, citação e recusa.
- **Segurança:** acesso cruzado, alteração de identificadores, domínio não autorizado, token expirado, rate limit e conteúdo malicioso.

### Matriz mínima de isolamento

Cada tentativa abaixo deve retornar ausência de dados ou erro de autorização, nunca existência parcial do recurso:

- administrador A acessando artigos, métricas ou conversas da empresa B;
- visitante A acessando conversa de outro visitante da mesma empresa;
- visitante da empresa A reutilizando token ou ID na empresa B;
- origem não autorizada carregando configuração privada ou criando conversa;
- usuário autenticado recuperando histórico depois de logout/expiração sem nova asserção válida.

## 11. Critérios de aceite para o piloto

### Funcionais

- [ ] Empresa configura a identidade, registra domínio e instala a central em página externa.
- [ ] Administrador cria, publica, edita e despublica conteúdo.
- [ ] Visitante busca, abre e lê artigo dentro do widget.
- [ ] IA responde pergunta coberta com fonte válida.
- [ ] IA faz pergunta objetiva ou declara falta de informação quando não há cobertura.
- [ ] Visitante solicita uma pessoa e vê estado e expectativa de resposta.
- [ ] Administrador vê histórico e resumo, responde e resolve o caso.
- [ ] IA não envia mensagens durante atendimento humano.
- [ ] Fechar e reabrir preserva conversa e estado de leitura.
- [ ] Logout invalida o acesso ao histórico identificado conforme o contrato de integração.
- [ ] Pendências, não lidas, avaliações, custo, erros e resultado desconhecido ficam registrados.

### Qualidade e segurança

- [ ] Matriz de isolamento multiempresa e por participante aprovada.
- [ ] Nenhum segredo é exposto no snippet ou no bundle do widget.
- [ ] Conteúdo renderizado é sanitizado e links seguem política segura.
- [ ] Fluxos críticos funcionam por teclado, têm foco visível e contraste adequado.
- [ ] Falha do provedor de IA não perde mensagem nem gera resposta duplicada.
- [ ] Logs permitem investigar uma conversa sem registrar credenciais ou conteúdo sensível desnecessário.
- [ ] Backup, restauração e rollback de migração foram ensaiados.

### Metas iniciais de operação

As metas abaixo são guardrails de lançamento, não promessa comercial:

- carregamento do loader do widget com orçamento definido e monitorado;
- abertura do painel sem bloquear a aplicação hospedeira;
- disponibilidade e latência medidas separadamente para API, busca e IA;
- 100% das execuções de IA com tenant, duração, resultado e custo registrados;
- 0 falhas conhecidas de acesso cruzado nos testes de isolamento;
- 0 respostas automáticas enviadas após transferência confirmada.

Os números de latência e orçamento de bundle devem ser fixados na semana 1 após medir o ambiente real, evitando metas arbitrárias.

## 12. Métricas do piloto

### Adoção

- visitantes que abrem o widget;
- visitantes que usam busca, leem artigo ou iniciam conversa;
- conversas por empresa e retorno ao histórico.

### Qualidade do conhecimento e da IA

- busca sem resultado;
- pergunta coberta, não coberta ou ambígua;
- resposta avaliada positiva/negativamente;
- fonte aberta após resposta;
- taxa de transferência solicitada e sugerida;
- dúvidas recorrentes sem conteúdo correspondente.

### Continuidade humana

- tempo até primeira resposta humana;
- tempo humano até resolução confirmada;
- casos em que o visitante precisou repetir informação;
- mensagens respondidas e ainda não lidas;
- resolvido explicitamente versus resultado desconhecido.

### Operação e custo

- tokens e custo por conversa/empresa;
- falhas e timeout por etapa;
- profundidade e idade da fila aguardando humano;
- artigos criados ou atualizados a partir de lacunas observadas.

## 13. Riscos e mitigação

| Risco | Mitigação no plano |
|---|---|
| Vazamento entre empresas ou visitantes | `tenant_id` derivado da sessão, RLS, testes negativos e auditoria |
| Identidade falsa enviada pelo navegador | Asserção assinada pelo backend do cliente; nome isolado não autentica |
| IA inventar ou usar conteúdo errado | Contexto somente publicado, fontes, recusa, avaliações e limite de escopo |
| IA responder junto com atendente | Máquina de estados e bloqueio transacional antes de enfileirar resposta |
| Widget quebrar o site hospedeiro | Loader pequeno, `iframe`, CSP e teste em páginas externas variadas |
| Cookies bloqueados em contexto incorporado | Validar alternativas de sessão nos navegadores-alvo antes de conectar histórico; registrar degradação explícita |
| Custos crescerem sem percepção | Limites, telemetria por execução e painel por empresa |
| Caixa humana virar help desk completo | Manter apenas listar, assumir, responder, resolver e reabrir |
| Busca simples perder qualidade | Medir zero-resultados e avaliações antes de introduzir embeddings |
| Escopo visual consumir o cronograma | Sistema visual pequeno e foco nos estados críticos e acessibilidade |

## 14. Marcos de decisão

### Primeira entrega — integração externa validada

Prosseguir para conexões de dados quando snippet, identidade da empresa, abrir/fechar, navegação e preservação do funcionamento do host atenderem aos critérios de P1 no plano de implementação. Sessão e mecanismo de atualização serão validados na etapa de histórico e atendimento humano.

### Fim da semana 4 — continuidade validada

O fluxo humano completo deve funcionar sem IA. Se não funcionar, não iniciar recursos secundários; corrigir persistência, leitura e autorização.

### Fim da semana 5 — IA validada

Comparar resultados do conjunto de avaliação. Adicionar busca vetorial apenas se busca textual + conteúdo bem estruturado não atingir qualidade aceitável.

### Fim da semana 7 — go/no-go do piloto

Bloqueadores de lançamento: acesso cruzado, perda/duplicação de mensagens, IA ativa após transferência, ausência de rastreio de custo ou fluxo crítico inacessível.

## 15. Entregáveis de engenharia e produto

- Código e migrações versionados no monorepo.
- Ambientes local, homologação e produção.
- Página externa de demonstração usada nos testes E2E.
- Contrato de instalação, identidade e logout para clientes.
- Conjunto versionado de avaliação da IA.
- Painel operacional e alertas mínimos.
- Runbook de falhas de IA, fila, banco e entrega de mensagens.
- Checklist de segurança, acessibilidade e piloto assinado.
- Guia curto de onboarding para empresa piloto.

## 16. Próxima ação recomendada

Preparar o contrato mínimo e executar a prova externa descrita em P0/P1 do plano de implementação: snippet, configurações públicas de duas empresas, iframe em outra origem, navegação e critérios de aceite reproduzíveis.

Banco e autenticação administrativa são decisões da fundação persistente; identificação assinada e transporte entram antes do histórico; provedor/modelo e teto de custo entram antes da IA. Essas escolhas não bloqueiam a primeira entrega.
