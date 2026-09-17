# Roadmap

Status: ativo  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

Este documento reúne apenas trabalho ainda necessário. Planos detalhados já
concluídos permanecem no arquivo histórico.

## Prioridade imediata

- Concluir e validar o login administrativo por usuário e senha atualmente em
  desenvolvimento.
- Executar avaliação comparativa da Nora com orçamento, modelo e revisão humana
  registrados.
- Corrigir e validar o manifesto de deploy, incluindo o serviço privado de
  embeddings e `EMBEDDINGS_URL` no worker.
- Executar o indexador de conhecimento como serviço contínuo em homologação e
  produção; hoje `npm run knowledge:index` processa a fila e encerra.
- Homologar duas instalações em origens HTTPS distintas.

## Antes do piloto

- Validar Safari/iOS em dispositivo real.
- Medir latência e consumo com volume representativo; registrar p50/p95 e
  concorrência.
- Definir e ensaiar backup, restauração, retenção e rollback.
- Configurar alertas para API, filas, falhas de geração e indexação.
- Fazer revisão de segurança da configuração de produção e dos privilégios do
  banco.

## Evoluções posteriores

- Streaming de respostas.
- Sincronização de estado entre abas.
- Atendimento humano e caixa de entrada operacional.
- Identidade do visitante entre dispositivos.
- Importação de PDF e DOCX com revisão da extração.

Cada item concluído deve gerar documentação operacional vigente e, quando
relevante, uma decisão em `docs/project/decisoes/`. Relatórios datados vão para
`docs/archive/verification/`.
