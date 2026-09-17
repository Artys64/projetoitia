> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# MVP — Central de suporte incorporada ao produto

Data: 09/09/2026. Direção definida a partir da referência visual enviada pelo usuário: o painel de suporte aberto dentro do Claude.

Este documento passa a orientar o recorte de produto. As especificações anteriores de chatbot de FAQs são material de base e precisam ser adaptadas a este fluxo antes da implementação. A pesquisa de mercado continua útil; sua recomendação de exigir uma ação transacional no primeiro MVP é substituída pela validação da central de suporte integrada.

## 1. Produto que queremos construir

Uma central de suporte que qualquer empresa possa instalar no próprio site ou aplicação, com três áreas: **Início, Mensagens e Ajuda**. O usuário encontra conteúdo, conversa com uma IA baseada na documentação da empresa e continua o atendimento com uma pessoa quando necessário, preservando o histórico.

A referência é o padrão de experiência do Intercom Messenger com Fin usado no suporte do Claude. A documentação oficial do Claude confirma uso do Fin, busca de ajuda e encaminhamento para atendimento humano assíncrono, com resposta na mesma conversa e por e-mail. As opções de acesso humano variam por plano e papel no Claude; isso é uma regra daquele serviço, não um requisito do nosso produto. [Suporte do Claude](https://support.claude.com/en/articles/9015913-how-to-get-support)

A documentação do Intercom descreve seções `home`, `messages` e `help`, além de personalização e busca da central de ajuda dentro do Messenger. [Seções](https://developers.intercom.com/installing-intercom/web/methods) · [Personalização](https://www.intercom.com/help/en/articles/6612597-messenger-faqs)

O objetivo é reproduzir essa organização e seus fluxos com a identidade de cada empresa cliente. A captura mostra a tela inicial; telas internas abaixo são propostas de produto apoiadas na documentação, não observações da imagem.

## 2. Experiência do widget

| Área | Conteúdo e comportamento |
|---|---|
| Início | Saudação, botão para iniciar atendimento, busca de ajuda, links de destaque e cartão opcional de status |
| Mensagens | Lista de conversas anteriores, prévia da última mensagem, estado do atendimento e indicação de mensagens não lidas |
| Conversa | Mensagens do usuário, IA e atendente identificadas; respostas com links de referência; opção de solicitar humano e retomar o histórico |
| Ajuda | Busca por artigos e FAQs, categorias simples e leitura dentro do painel |

Características visuais da referência: painel flutuante à direita, fundo escuro, bordas arredondadas, cartões separados, saudação em destaque e navegação inferior fixa. Como referência aproximada de desktop, o painel ocupa cerca de 400 px de largura. A altura deve caber na janela; no celular, adaptar para uma área ampla e utilizável.

Comportamentos essenciais: abrir e fechar sem perder a conversa, manter a navegação durante o uso, rolar o conteúdo sem ocultar a barra inferior, permitir teclado e foco visível e respeitar a preferência de movimento reduzido.

A saudação personalizada depende de identificação fornecida pela aplicação. Visitantes sem identificação recebem uma saudação genérica. O nome apresentado não funciona como prova de identidade.

O cartão de status é configurável e opcional. Pode mostrar um comunicado manual datado e um link para a página de status. Estado operacional automático depende de uma fonte real; se ela falhar ou estiver desatualizada, apresentar indisponibilidade da informação. Sem configuração, ocultar o cartão.

## 3. Fluxo de atendimento do MVP

1. Usuário abre a central pelo botão flutuante ou pelo menu de ajuda do produto.
2. Pode pesquisar conteúdo imediatamente ou selecionar “Envie uma mensagem”.
3. IA entende a dúvida e responde usando artigos e FAQs publicados pela empresa.
4. Se faltar informação, faz uma pergunta objetiva ou informa a limitação.
5. Usuário pode solicitar atendimento humano. Falta de cobertura ou tentativa malsucedida também pode gerar encaminhamento.
6. Conversa passa para “Aguardando equipe”, preservando histórico, resumo e contexto mínimo da página. A IA deixa de responder automaticamente enquanto o humano conduz o caso.
7. Responsável da empresa responde por uma caixa de entrada simples no painel administrativo.
8. Resposta aparece na mesma conversa, com indicador de mensagem não lida. Usuário pode fechar e retornar depois.
9. Ao concluir, solicitar confirmação ou avaliação simples. Inatividade isolada fica como resultado desconhecido.

Atendimento humano é assíncrono. A interface deve informar expectativa de resposta configurada pela empresa, sem fingir disponibilidade imediata. Notificação por e-mail é uma evolução útil; responder por e-mail mantendo a conversa sincronizada não é requisito inicial.

## 4. Escopo obrigatório

| Componente | Entrega mínima |
|---|---|
| Instalação | Snippet para abrir a central em site externo; configuração de domínio e ativação/desativação |
| Identidade visual | Nome da empresa/assistente, saudação, cor de destaque e aparência baseada na referência |
| Início | Entrada para atendimento, busca e links configuráveis |
| Conhecimento | Cadastro e edição de artigos/FAQs, publicação, categorias e busca simples |
| IA | Respostas baseadas no conteúdo publicado, indicação de fonte quando aplicável e reconhecimento de falta de informação |
| Histórico | Conversas persistentes, reabertura e mensagens não lidas |
| Atendimento humano | Caixa de entrada mínima para o administrador ver, responder e marcar o caso como resolvido |
| Transferência | Estado explícito, resumo, histórico preservado e interrupção das respostas automáticas |
| Operação | Lista de dúvidas não resolvidas, avaliações, custos e erros básicos |
| Controle de acesso | Conversas acessíveis apenas aos participantes e à empresa responsável; sessões validadas no servidor e isolamento por cliente |

Para o piloto, o administrador pode ser também o atendente. Não é necessário criar departamentos, distribuição automática, SLAs ou uma plataforma completa de gestão de equipe.

O painel terá cinco áreas principais: **Configuração, Conhecimento, Conversas, Testar IA e Instalação**. A mesma base alimenta a busca de ajuda e o assistente, para evitar respostas divergentes.

## 5. O que fica para depois

- Ações em sistemas externos, como reembolsar, alterar plano ou cancelar pedido.
- Consulta de dados privados de negócio além dos necessários à identidade e ao atendimento.
- Importação universal de APIs e marketplace de conectores.
- Sincronização bidirecional de e-mail, WhatsApp e outros canais.
- Monitoramento próprio de disponibilidade; no início usar comunicado ou fonte de status configurada.
- Filas avançadas, departamentos, SLA, roteamento e automações complexas.
- Crawler amplo, documentos complexos, múltiplos agentes e escolha de vários modelos.

Uma base pequena de artigos permite começar com busca simples e contexto controlado. A necessidade de recuperação mais sofisticada deve ser decidida pelos resultados das avaliações e pelo volume de conteúdo.

## 6. Por que uma empresa pagaria por este recorte

Hipótese de valor: concentrar ajuda e atendimento no lugar onde o cliente encontra a dificuldade, resolver dúvidas recorrentes e reduzir o esforço para continuar com uma pessoa.

| Benefício esperado | Medição |
|---|---|
| Resposta sem esperar a equipe | Tempo até resolução confirmada de dúvidas elegíveis |
| Menos procura por conteúdo em lugares diferentes | Sucesso da busca e avaliação dos artigos |
| Menos repetição durante a transferência | Tempo humano após encaminhamento e necessidade de pedir dados novamente |
| Continuidade após fechar o widget | Retomadas de conversa e leitura de respostas |
| Melhor aproveitamento do conhecimento | Perguntas sem resposta e esforço de manutenção da base |

A semelhança visual com a referência não prova valor comercial. O piloto deve medir adoção, qualidade da resposta, continuidade humana e disposição a renovar. Para esse recorte, Intercom é o concorrente e a referência funcional principal; Crisp, Tidio e Chatbase continuam relevantes.

## 7. Critérios para entrar em piloto

- Empresa instala em uma página externa, publica conteúdo e personaliza sua central.
- Visitante encontra, abre e lê um artigo dentro do widget.
- IA responde uma pergunta coberta e trata corretamente uma pergunta sem cobertura.
- Usuário solicita humano; o administrador recebe o histórico e responde na mesma conversa.
- Fechar e reabrir preserva o atendimento; atualização de página não expõe conversas de outra pessoa.
- Encerrar sessão na aplicação encerra o acesso ao histórico autenticado daquele usuário no widget.
- Casos pendentes e respostas não lidas são distinguíveis; IA não disputa a conversa com o humano.
- Duas empresas e dois usuários não conseguem acessar os históricos uns dos outros.
- Custo, feedback e resultado desconhecido são registrados sem contabilizar abandono como resolução.

O primeiro teste comercial deve reunir empresas que já tenham usuários ativos no site ou aplicação e uma pessoa disponível para responder às transferências. Não é necessário automatizar transações para validar este recorte.

Sequência recomendada: construir a navegação e a base de ajuda; completar conversa persistente e resposta humana; acrescentar IA e transferência; medir o fluxo inteiro em pilotos pagos. O prazo de duas a quatro semanas dos documentos anteriores precisa ser reestimado para incluir a continuidade humana e o histórico.
