# Base de conhecimento: importação e gestão pelo painel

Data: 15/09/2026. Status: proposta; implementação não iniciada nesta revisão.

## 1. Objetivo e decisões

Prioridade confirmada pelo usuário: importar documentos e gerenciar a base pelo painel.

Requisito explícito do usuário: cada empresa possui seu próprio contexto. Documentos, configurações específicas, trechos recuperados e histórico de conversas de uma empresa não podem compor o contexto de outra.

Primeiro marco: um administrador entra na empresa, envia um documento, acompanha o processamento, revisa o texto, publica e confirma que a Nora encontra o conteúdo. Depois consegue editar, substituir e despublicar sem usar a CLI.

Este plano altera a sequência do [plano geral de RAG](plano-implementacao-rag.md): autenticação, importação e edição entram no primeiro marco. A avaliação acompanha as entregas; o avaliador completo não bloqueia o início do painel. Por decisão posterior do usuário, embeddings e pgvector passam ao escopo principal, detalhado no [plano de RAG completo](plano-pgvector-rag-completo.md).

Formatos confirmados pelo usuário: texto e Markdown primeiro; PDF e DOCX depois. A primeira versão aceita texto digitado/colado e arquivos `.txt` e `.md` em UTF-8. PDF e DOCX são uma entrega posterior; OCR, crawler e conectores exigirão escopo próprio.

Publicar significa disponibilizar o texto revisado às respostas do widget da empresa. Arquivos originais ficam privados para administradores. Publicação não torna automaticamente o arquivo original acessível aos visitantes. Conhecimento restrito por identidade do visitante exige permissões adicionais e não faz parte deste primeiro marco.

## 2. Base existente e lacunas confirmadas

- `apps/admin/src/App.tsx`: seleção simples entre demonstração e chatbot; não há biblioteca, editor ou login administrativo.
- `apps/api/src/db/admin.ts`: importação por CLI, versões imutáveis e ponteiro de versão publicada. Importar `draft` atualmente despublica o artigo; salvar um rascunho no painel precisará de uma operação diferente.
- `articles` e `article_versions`: reaproveitar como conhecimento publicado, com migrações aditivas.
- `apps/api/src/ia/knowledge/repository.ts`: limite atual de 50.000 caracteres por artigo e 1.000 artigos por lote. Documentos longos exigem divisão editorial explícita ou revisão desses limites; nunca truncar silenciosamente.
- `apps/api/src/db/knowledge.ts`: carrega todos os artigos publicados por consulta. A nova importação deve alimentar trechos persistidos e busca SQL.
- `jobs`: vinculada por chave estrangeira a execuções de chat; não é uma fila genérica de importação.
- `apps/worker/src/index.ts`: executa somente chat e exige chave Groq. Processamento documental deve poder funcionar sem chave de geração.
- `apps/api/src/app.ts`: API sem rotas administrativas e com limite global de corpo de 128 KiB. Upload requer limites e tratamento próprios, mantendo limites do chat.

## 3. Experiência no painel

Fluxo: **entrar → Base de conhecimento → importar → acompanhar → revisar → publicar → testar com a Nora**.

| Tela | Comportamento |
| --- | --- |
| Acesso | Login, saída e empresa ativa, com associação conferida pelo backend |
| Biblioteca | Lista paginada; busca por título; filtros por estado e formato; ações de criar, importar e arquivar |
| Importação | Arquivo, título sugerido, progresso de envio e processamento, erro compreensível e nova tentativa |
| Revisão | Texto extraído editável, origem, avisos de extração, palavras-chave e indicação de alterações ainda não publicadas |
| Histórico | Versões publicadas, autor/data, substituição de arquivo e restauração como nova revisão |
| Teste | Pergunta, resposta e trechos consultados, com indicação explícita de teste de rascunho ou da base publicada |

Separar estado do processamento (`queued`, `processing`, `ready`, `failed`) do estado editorial (`draft`, `published`, `archived`). Um item pode estar publicado e ter uma nova revisão em processamento. A falha dessa revisão não retira a publicação anterior.

Primeiro implementar teste da base publicada. Teste de rascunho entra depois, com endpoint administrativo próprio, fontes da revisão selecionada e limites de consumo; não conectar rascunhos à busca dos visitantes.

## 4. Arquitetura e dados

### Isolamento obrigatório do contexto por empresa

- Resolver a empresa no backend pela instalação/sessão do widget ou pela associação administrativa autorizada. A empresa não é escolhida pelo modelo, por instruções no documento ou apenas por um `companyId` recebido do navegador. Sem empresa válida, bloquear a operação.
- Vincular documentos, arquivos, revisões, rascunhos, artigos, trechos, trabalhos e eventos à empresa. Usar referências compostas que impeçam relações entre empresas e validar autorização também em downloads, histórico e testes administrativos.
- Restringir os candidatos à empresa e às versões autorizadas antes do ranking e do limite de resultados. A mesma regra vale para uma futura busca vetorial. Conferir a empresa das evidências antes de montar o contexto enviado ao modelo e antes de publicar a resposta.
- Montar cada interação com instruções gerais do produto, configurações da empresa quando existirem, histórico somente da conversa autorizada e evidências somente daquela empresa. Instruções gerais compartilhadas não contêm fatos particulares de clientes. Histórico não substitui evidência publicada.
- Não usar conteúdo de outra empresa como fallback quando a busca local não encontra orientação. Nesse caso, a Nora informa a falta de informação ou pede esclarecimento conforme a pergunta.
- Isolar qualquer cache futuro por empresa, versão da base/estratégia e demais parâmetros relevantes; cache de resposta ou memória também depende da conversa e das permissões. Deduplicação de arquivo não concede acesso entre empresas.
- Ao trocar a empresa no painel, limpar estado de documentos, resultados e chat de teste, cancelar requisições anteriores e ignorar respostas tardias da empresa anterior. Cada requisição captura sua empresa autorizada; uma troca posterior da empresa ativa não redireciona trabalhos em curso.
- Testes do painel seguem o mesmo isolamento do atendimento. Acesso a várias empresas pelo mesmo administrador não autoriza misturar suas bases em uma resposta.

Critério de aceite: cadastrar o mesmo título/ID de artigo em duas empresas com horários ou políticas diferentes; fazer a mesma pergunta nas duas e conferir as evidências e o contexto efetivamente enviados ao modelo. Repetir com busca vazia em uma empresa, IDs forjados, troca de empresa durante requisição, cache aquecido, jobs concorrentes e conexão de banco reutilizada. Nenhum trecho, configuração ou histórico da outra empresa pode ser enviado ao modelo ou exposto na resposta. Esse critério é obrigatório desde P0/P1 e acompanha todas as entregas.

### Acesso administrativo

Autenticação administrativa separada das sessões anônimas do widget. Identidade validada no servidor, associação usuário–empresa e permissões de leitura/edição/publicação. Proposta inicial: administrador pode gerenciar e publicar; editor pode preparar revisões. Criação do primeiro administrador por procedimento controlado, sem cadastro público irrestrito.

Selecionar a biblioteca ou provedor de identidade na primeira entrega, após conferir compatibilidade com Fastify/React, recuperação de acesso e hospedagem. Nenhum serviço externo foi escolhido ou provisionado. Preferir sessão em cookie HttpOnly com política de origem/CSRF adequada à implantação. Conferir associação e permissão em cada operação, inclusive download e status de importação.

### Modelo proposto

| Entidade | Responsabilidade |
| --- | --- |
| Usuário, sessão administrativa e associação à empresa | Identidade, revogação e permissões |
| Documento | Identidade estável, empresa, título e estado de arquivamento |
| Revisão do documento | Arquivo privado, hash, tipo/tamanho, extrator e sua versão, texto extraído e estado do processamento |
| Rascunho editorial | Texto revisado e controle de concorrência; separado da versão publicada |
| Artigos e versões existentes | Conteúdo efetivamente publicado e vínculo com sua revisão de origem |
| Trechos indexados | Empresa, artigo/versão, algoritmo de divisão, texto exato, hash e localização na origem quando disponível |
| Trabalho de importação | Estado, tentativa, prazo, lease e erro classificado |
| Evento editorial | Autor, empresa, ação, versões e data, sem copiar o documento inteiro para logs |

Um documento pode originar vários artigos por seção, mantendo vínculo com a revisão. A tela deve mostrar essa divisão antes de publicar. Proposta inicial: manter o limite de 50.000 caracteres por artigo e permitir ajuste manual das seções. Na substituição, publicar o conjunto revisado e retirar as seções antigas substituídas na mesma transação. Artigos criados manualmente continuam independentes.

### Upload e processamento

1. Autenticar, autorizar e reservar cota antes de aceitar o arquivo. Proposta inicial ajustável para TXT/Markdown: um arquivo por requisição, até 1 MiB e 200.000 caracteres por documento, dividido em artigos de até 50.000 caracteres. Arquivos fora dos limites recebem erro explícito.
2. Validar formato real, tamanho e nome; gerar chave interna. Receber por streaming com limite explícito e descartar uploads incompletos. O plugin oficial [Fastify Multipart](https://github.com/fastify/fastify-multipart) suporta streaming e limites por upload.
3. Guardar o original em armazenamento privado durável acessível pela API e pelo processador. Provedor a definir antes da entrega de upload; armazenamento local serve ao desenvolvimento. Não depender do diretório temporário de uma instância para jobs assíncronos.
4. Registrar arquivo confirmado e trabalho durável. Como arquivo e banco não compartilham transação, usar estado intermediário e reconciliação de uploads órfãos. Deduplicar dentro da empresa por hash e intenção da operação, sem impedir reprocessamento explícito com outro extrator.
5. Processar em executor separado, com limite de memória, tempo e concorrência, tentativas limitadas e descarte de conclusão de lease vencido. A tabela nova de importações evita adaptar artificialmente `jobs` do chat.
6. Validar UTF-8 e rejeitar binários; normalizar quebras de linha, preservando títulos, listas, tabelas e blocos de código Markdown. Não executar conteúdo nem buscar recursos externos do documento. Preview Markdown deve desabilitar HTML bruto e tratar links com protocolos permitidos; imagens remotas não são carregadas automaticamente.
7. Mostrar o texto importado e a divisão proposta em seções antes da publicação. Não resumir automaticamente nem truncar o conteúdo. Na futura entrega PDF/DOCX, selecionar extratores com fixtures representativas, preservar páginas quando confiáveis, limitar descompressão e recursos, e sinalizar extração parcial ou ausência de texto.
8. Disponibilizar rascunho para revisão. O arquivo original não vira conteúdo publicado automaticamente.

Tipos permitidos, armazenamento privado, nomes gerados e limites seguem a [orientação de upload da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). Conferir os limites com arquivos representativos, especialmente tabelas e listas. TXT não possui uma assinatura universal; combinar extensão permitida, decodificação estrita, conteúdo e limites, sem confiar apenas no MIME declarado.

### Publicação e recuperação

- Salvar rascunho mantém a versão publicada. Usar revisão esperada/ETag para impedir que duas abas sobrescrevam alterações silenciosamente.
- Publicar fixa um snapshot editorial imutável e prepara os trechos dessa revisão. Ativar o novo conjunto apenas após indexação completa, conferindo revisão esperada e permissão novamente na transação final.
- Persistir trechos por seção, mantendo procedimentos juntos quando possível. Identidades de evidência incluem a versão da divisão, evitando atribuir texto novo a uma referência antiga.
- Buscar no PostgreSQL somente trechos da empresa e das versões publicadas, com RLS e permissões mínimas. Continuar usando o contrato `KnowledgeSearch`, versionando-o caso a identidade das fontes mude.
- Despublicar remove a versão da recuperação imediatamente no banco. Preservar a revalidação do worker para bloquear uma resposta em curso cujas fontes foram invalidadas.
- Arquivar remove o item da base ativa e da listagem padrão, com possibilidade de restaurar. Restauração fica em rascunho até publicação explícita.
- Remoção definitiva de arquivos precisa de retenção definida antes do piloto, limpeza de derivados e tratamento dos vínculos de auditoria. Não confundir arquivamento com exclusão física.

## 5. Contratos e áreas de implementação

Rotas propostas, ainda inexistentes, sob `/api/admin`: sessão e empresa ativa; lista/detalhe de documentos; upload e estado da importação; leitura/salvamento de rascunho; publicação; despublicação; histórico; arquivamento; teste de conhecimento. IDs de empresa enviados pelo cliente não conferem autorização. Publicação, importação e retry devem ser idempotentes; erros de edição concorrente retornam conflito.

| Área | Mudanças previstas |
| --- | --- |
| `packages/contracts/src/knowledge.ts` (novo) | Estados, paginação, payloads, validação e erros administrativos |
| `apps/admin/src` | Rotas protegidas, biblioteca, upload, editor, histórico e teste |
| `apps/api/src` | Rotas administrativas, identidade, armazenamento, publicação e extração |
| `apps/api/migrations` | Migrações aditivas de identidade, documentos, revisões, trabalhos, eventos e trechos |
| `apps/api/src/db/admin.ts` | Extrair serviço editorial compartilhável; manter semântica da CLI explicitamente documentada |
| `apps/api/src/db/knowledge.ts` | Busca de trechos publicados no SQL |
| `apps/worker` | Entrada de processamento documental independente da geração de chat |

## 6. Ordem de entrega e aceite

| Entrega | Resultado verificável |
| --- | --- |
| P0 — Fundação e acesso | Validar estado atual; login real, associação à empresa e biblioteca protegida; identidade e armazenamento decididos |
| P1 — Gestão de texto | Criar, editar, publicar e despublicar texto pelo painel; versão anterior continua ativa durante edição; Nora recupera a publicação |
| P2 — Upload durável | Enviar `.txt`/`.md` e acompanhar job após recarregar; retry não duplica; outra empresa não acessa original nem status |
| P3 — Importação e revisão | UTF-8 validado, Markdown preservado, preview seguro e seções revisáveis; arquivos sem suporte falham claramente; substituição preserva versão anterior |
| P4 — Indexação e publicação | Trechos persistidos e busca SQL; conjunto de seções publicado atomicamente; fonte invalidada bloqueia resposta em curso |
| P5 — Validação do produto | Histórico e arquivamento; teste da base publicada no painel; corpus ampliado com documentos; fluxo completo com duas empresas |
| Posterior — PDF e DOCX | Extratores, limites e avisos próprios, aproveitando revisão/publicação já entregues; OCR depende de decisão futura |

P1 entrega gestão útil antes do upload de arquivos. P2–P3 podem usar a busca atual em ambiente limitado para validar a experiência; o piloto com documentos depende de P4. A indexação e o avaliador podem avançar como trabalhos independentes, sem exigir múltiplos agentes.

Testes essenciais: autorização administrativa e isolamento; rascunho versus publicação; upload interrompido, binário e UTF-8 inválido; preservação de tabela/lista/bloco de código; HTML e links inseguros no preview; documento longo; duplicação e retry; worker reiniciado ou atrasado; edição concorrente; substituição removendo seções antigas; despublicação durante geração; persistência após recarga. Usar fixtures sintéticas e comparar texto importado com o esperado, além de avaliação das respostas.

Aceite final: importar um documento conhecido, revisar e publicar; obter resposta correta sobre ele no widget; editar sem afetar a versão ativa; publicar a alteração e observar a nova resposta; despublicar e confirmar sua ausência na recuperação; repetir com outra empresa sem cruzamento de dados. Testes reais de IA usam orçamento registrado. As metas de qualidade do plano geral continuam propostas para o piloto.

## 7. Decisões abertas e próximo passo

- Formatos definidos: texto e Markdown na primeira versão; PDF e DOCX depois. OCR permanece fora do primeiro marco.
- Identidade administrativa e armazenamento privado: decisões técnicas de P0, com custos e configuração documentados antes de qualquer provisionamento.
- Limites por arquivo/empresa e retenção: valores iniciais propostos, a validar com tamanho e volume reais dos documentos.

Próxima implementação recomendada: P0 e P1, formando o primeiro fluxo administrativo completo. Este documento registra planejamento; não foram criadas rotas, tabelas, serviços externos ou telas nesta revisão.
