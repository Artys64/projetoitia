# Verificação do chat persistente — 14/09/2026

## Resultado e escopo

Implementados: PostgreSQL com migrações e papel de runtime limitado, sessões opacas, isolamento por empresa e visitante, histórico paginado, envio idempotente, reservas de uso, fila durável com lease, worker Nora/Groq, revalidação de fontes e compositor no iframe. Configuração Render preparada em `render.yaml`; nenhum serviço externo foi criado ou publicado nesta entrega.

A reorganização simultânea do projeto em `apps/api/src/ia` e `apps/widget/src/tela` foi preservada. O chatbot legado segue disponível em desenvolvimento e não é registrado em produção. Sem banco configurado, o snippet mantém sua demonstração navegável.

## Validação local executada

| Verificação | Resultado |
|---|---|
| Tipagem e builds de contratos, API, worker, loader, widget e painel | Aprovados |
| Testes unitários/API e contratos | 25 casos aprovados |
| Integração PostgreSQL 18.4 real | 11 cenários + teste agregador aprovados (12 no relatório Node) |
| Chat: Chromium, Firefox e WebKit, desktop e móvel | 24/24, zero falhas, skips ou flaky; 79,5 s |
| Regressão do snippet | Chromium/Firefox: 72/72; WebKit: 36/36 em rodada separada, 24,8 s |
| Blueprint Render | YAML parseado e campos essenciais conferidos; não validado por uma implantação remota |
| Avaliação Groq real | Transporte e ferramentas funcionaram; qualidade ainda não aprovada para piloto |

Os testes de banco incluem duas empresas e dois visitantes por empresa, RLS e reutilização de conexões, papéis sem bypass, migrações repetidas, versões imutáveis, envio concorrente/idempotente, rejeição de histórico forjado, paginação, reinício de banco, lease recuperada, worker atrasado, limite de tentativas, conversa encerrada durante geração, sessão expirada/revogada, instalação desativada, limites por empresa e IP. A execução mais recente usa a sequência da mensagem para encontrar a geração mais recente, independentemente do timestamp.

No navegador, o chat foi exercitado com provedor simulado e PostgreSQL real: envio e resposta, fechamento e recarga, retomada, confirmação HTTP perdida após commit, texto malicioso inerte, armazenamento bloqueado, erro da IA e encerramento de sessão. O envio do compositor usa eventos de botão/teclado e `fetch`, compatíveis com o sandbox do iframe sem `allow-forms`. Capturas ficaram em `test-results/chat/`. A regressão verificou três tamanhos de viewport em cada navegador. O WebKit passou após ajustar o teste para verificar os logs da aplicação antes da captura: o próprio Playwright injeta `body {}` para sincronizar animações durante screenshots, gerando avisos de CSP alheios ao widget. A CSP da aplicação foi preservada. `test-results/snippet-before-capture-fix.json` contém os 72 casos de Chromium/Firefox aprovados e o diagnóstico inicial do WebKit; `test-results/report.json` contém a rodada final de 36 casos WebKit aprovados.

O `--test-isolation=none` faz os testes TypeScript internos serem executados no ambiente atual. A biblioteca de PostgreSQL portátil fornece os binários; o teste inicia esses binários diretamente e gerencia seu encerramento para evitar o exit hook do wrapper mascarando falhas. Logs de conexão perdida durante o teste de reinício são esperados.

WebKit foi executado com bibliotecas Ubuntu extraídas para `/tmp` e ligadas ao bundle temporário do navegador; `ldd` confirmou as dependências. A checagem de pacotes do sistema foi desabilitada, não os testes. Procedimento em [operação](operacao-chat-persistente.md). Nenhuma instalação de pacotes no sistema foi feita.

## Tamanhos medidos

| Recurso | Bruto | Gzip | Meta gzip |
|---|---:|---:|---:|
| Loader JS | 5.384 B | 2.317 B | <3 KB |
| Loader CSS | 1.323 B | 537 B | — |
| Widget JS | 15.748 B | 5.856 B | <80 KB |
| Widget CSS | 4.193 B | 1.457 B | <20 KB |

Medições por `gzipSync`; a API local não aplica compressão HTTP.

## Avaliação real da Nora

Duas rodadas de três perguntas sintéticas foram executadas com a chave já configurada, `openai/gpt-oss-20b`, base demonstrativa `support-hub`. Nenhuma conversa de cliente real foi usada. A primeira consumiu 4.157 tokens; a segunda, após reforçar o prompt para `rag-agent-v3`, consumiu 4.748 tokens (8.905 no total). A rodada final levou 0,6–1,3 s por interação e teve respectivamente uma, uma e zero buscas para pergunta coberta, pergunta fora da base e agradecimento.

A qualidade **não foi considerada aprovada**: na rodada final, a resposta de senha ainda acrescentou a orientação de abrir o link para criar nova senha, embora o artigo só descreva solicitar/receber o link; para uma pergunta fora do produto, reconheceu a ausência de cobertura, mas pediu detalhes sobre o assunto externo. O reforço do prompt reduziu algumas extrapolações, sem eliminá-las. As regras de fundamentação não constituem validação determinística. O relatório completo está em `test-results/groq-evaluation.json`, e o script reproduzível em `scripts/evaluate-nora.mts`.

## O que ainda falta

- Conta/workspace Render, orçamento/região e sites de homologação; cadastrar a empresa real e seus artigos verificados.
- Aplicar migrações/provisionamento no banco remoto e publicar API/worker; validar certificado, proxy, domínio e duas origens HTTPS.
- Avaliar e corrigir a qualidade da Nora com critérios explícitos antes do piloto.
- Safari/iOS real, modo privado e comportamento de retomada nas condições exigidas pelo piloto.
- Backup/restauração em ambiente separado, alertas, retenção/exclusão, responsável operacional, RPO/RTO e orçamento. Reinício do banco local não substitui restauração de backup.

A entrega comprova o fluxo técnico local e prepara a homologação; não declara o MVP completo nem o piloto pronto para produção.
