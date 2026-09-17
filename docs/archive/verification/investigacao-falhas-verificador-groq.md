> **Arquivo histórico.** Este documento registra uma revisão anterior e pode não representar o código atual. Consulte [a documentação vigente](../../index.md).

# Investigação de falhas do verificador da Nora na Groq

Data da investigação: 14 de setembro de 2026  
Ambiente: homologação local  
Empresa de teste: `hml_a`  
Modelo configurado: `openai/gpt-oss-20b`

## Objetivo

Este documento registra a investigação das respostas que não apareceram no
widget porque a etapa de verificação da Nora foi bloqueada. Ele descreve as
evidências disponíveis, a instrumentação adicionada e o que ainda precisa ser
confirmado.

O conteúdo bruto das conversas, dos rascunhos, das respostas do provedor e das
credenciais não é registrado. Os exemplos usam somente identificadores e
metadados operacionais.

## Fluxo da resposta

Uma pergunta enviada pelo widget percorre estas etapas:

1. A API confirma a mensagem e cria um job.
2. O worker adquire o job e carrega o histórico autorizado.
3. O modelo principal produz um rascunho e, quando necessário, consulta a base
   de conhecimento da empresa.
4. Uma segunda chamada à Groq produz um parecer estruturado sobre o rascunho.
5. O servidor valida o parecer e publica somente uma resposta aprovada ou uma
   alternativa permitida pela política.
6. O worker grava o resultado em `ai_run_attempts` e conclui ou bloqueia a
   execução.

Uma falha na etapa 4 ou 5 preserva a pergunta, mas impede a publicação do
rascunho. O widget apresenta a execução como falha e permite uma nova tentativa
quando aplicável.

## Como `verification_unavailable` é produzido

`verifyNoraDraft` converte uma falha de chamada ao provedor em uma publicação
bloqueada com código `unavailable`. O worker identifica que existe uma auditoria
de verificação, adiciona o prefixo `verification_` e grava
`verification_unavailable` em `ai_runs.error_code` e
`ai_run_attempts.error_code`.

Os pontos relevantes são:

- `apps/api/src/ia/verify-draft.ts`: chamada estruturada, classificação do erro
  e criação de `VerificationAudit`.
- `apps/api/src/ia/verified-response.ts`: composição das auditorias de geração e
  verificação.
- `apps/api/src/db/worker.ts`: prefixo `verification_`, persistência da tentativa
  e emissão do log correlacionado.

A string `verification_unavailable` é criada pela aplicação. Ela não é uma
mensagem literal enviada pela Groq.

## Evidência anterior à instrumentação

A tentativa abaixo já comprovava que a geração havia terminado e que a
verificação havia falhado, mas não preservava a categoria do erro do provedor:

```json
{
  "run_id": "cebb3bbc-c386-4eec-86c0-01400797af8a",
  "attempt": 1,
  "state": "blocked",
  "error_code": "verification_unavailable",
  "generation_completed": true,
  "generation_model": "openai/gpt-oss-20b",
  "verification_model": null,
  "verification_decision": null,
  "verification_failure": "unavailable",
  "verification_duration_ms": 158
}
```

O registro começou às `2026-09-14T19:38:34.565Z`, correspondente a 16:38:34
em `America/Fortaleza`. Como o código descartava a exceção original, não é
possível reconstruir retroativamente se essa tentativa falhou por HTTP, rede,
autenticação ou limite do provedor.

## Instrumentação adicionada

`VerificationAudit` agora registra:

| Campo | Descrição |
| --- | --- |
| `provider` | Adaptador usado pelo SDK, por exemplo `groq.chat`. |
| `configuredModel` | Modelo solicitado pela aplicação. |
| `model` | Modelo informado na resposta, quando a chamada chega a responder. |
| `errorCategory` | Categoria segura da falha. |
| `httpStatus` | Status HTTP retornado pelo provedor, quando disponível. |
| `retryable` | Indicação do SDK sobre repetição da chamada. |
| `providerRequestId` | Identificador seguro da requisição para correlação. |
| `failureCode` | Decisão de bloqueio usada internamente. |
| `durationMs` | Duração da etapa de verificação. |

As categorias atuais são:

| Categoria | Interpretação |
| --- | --- |
| `authentication` | HTTP 401 ou 403. |
| `rate_limit` | HTTP 429. |
| `provider_5xx` | HTTP 5xx. |
| `provider_http` | Outro erro HTTP, como 400. |
| `network` | A chamada falhou sem status HTTP. |
| `timeout` | O prazo local da etapa expirou ou era insuficiente. |
| `invalid_response` | A resposta não gerou o objeto estruturado esperado. |
| `unknown` | Exceção não reconhecida. |

O código não copia `error.message`, URL, causa, corpos da requisição ou resposta,
prompt nem headers arbitrários. Apenas um `x-request-id` com formato restrito
pode ser persistido.

## Log correlacionado do worker

Após o commit da tentativa bloqueada, o worker emite `verification_failed` em
JSON. O evento contém o mesmo `runId` e número da tentativa gravados no banco:

```json
{
  "event": "verification_failed",
  "tenantId": "hml_a",
  "runId": "6d3e0051-b76b-4752-a1da-fdb8faca2f76",
  "attempt": 1,
  "code": "verification_unavailable",
  "failureCode": "unavailable",
  "errorCategory": "provider_http",
  "provider": "groq.chat",
  "configuredModel": "openai/gpt-oss-20b",
  "model": null,
  "httpStatus": 400,
  "retryable": false,
  "providerRequestId": "req_01m2grg898eb0r0e1145byp1tc",
  "durationMs": 3958
}
```

O registro correspondente em `ai_run_attempts` contém os mesmos valores dentro
de `audit.verification`. Isso comprova que, nessa tentativa, a chamada do
verificador foi rejeitada pela Groq com HTTP 400 e que o SDK marcou o erro como
não repetível.

O status 400 não informa sozinho qual campo ou recurso foi rejeitado. O corpo da
resposta não foi persistido, de acordo com a política de não armazenar conteúdo
potencialmente sensível. O `providerRequestId` permite correlacionar a chamada
com observabilidade ou suporte do provedor.

## Falha distinta: `verification_invalid_verdict`

Uma chamada diagnóstica posterior chegou a receber um parecer da Groq, mas o
objeto não coincidiu com o rascunho. O modelo declarou aprovação, porém informou
segmentos com posições e textos incompatíveis:

```json
{
  "decision": "approve",
  "draftLength": 132,
  "segments": [
    { "start": 0, "end": 91, "quoteLength": 87, "quoteMatches": false },
    { "start": 91, "end": 136, "quoteLength": 45, "quoteMatches": false }
  ],
  "complete": false
}
```

Essa situação gera `verification_invalid_verdict`, não
`verification_unavailable`. Ela demonstra que existem dois modos de falha:

- o provedor rejeita a chamada por HTTP antes de devolver um parecer válido;
- o provedor responde, mas o objeto produzido não satisfaz o contrato exato.

## Como consultar a auditoria

As tabelas usam RLS. Uma consulta com o papel de runtime precisa definir a
empresa dentro de uma transação; sem isso, nenhuma linha fica visível.

```sql
BEGIN;

SELECT set_config('app.tenant_id', 'hml_a', true);

SELECT
  run_id,
  attempt,
  state,
  error_code,
  started_at,
  finished_at,
  audit->'verification' AS verification
FROM ai_run_attempts
WHERE run_id = '6d3e0051-b76b-4752-a1da-fdb8faca2f76';

ROLLBACK;
```

Para acompanhar o worker localmente:

```bash
npm run dev:widget
```

Os eventos relevantes aparecem como uma linha JSON iniciada por:

```text
[worker] {"event":"verification_failed", ...}
```

Use `runId` e `attempt` para comparar o log com `ai_run_attempts`. Não use o
texto da conversa como chave de busca em logs.

## Validação realizada

Após a mudança:

- a checagem TypeScript da API passou;
- 60 testes unitários e HTTP da API passaram;
- 26 testes com PostgreSQL e worker passaram;
- os testes cobrem HTTP 401, 403, 429, outros 4xx, 5xx e falha sem status;
- os testes conferem que mensagem, URL, prompt, corpo e headers arbitrários não
  aparecem na auditoria;
- a API atualizada respondeu `status: ok` em `http://localhost:3100/api/health`.

## Próximas ações

1. Correlacionar `req_01m2grg898eb0r0e1145byp1tc` com os registros da Groq para
   descobrir a justificativa específica do HTTP 400.
2. Reproduzir a mesma pergunta sintética algumas vezes, com um limite pequeno e
   registrando apenas os metadados seguros, para medir se o 400 é intermitente.
3. Separar as métricas de `provider_http` das métricas de `invalid_response` e
   `invalid_verdict`.
4. Simplificar o contrato do verificador para não depender de posições exatas
   produzidas pelo modelo, mantendo a validação determinística no servidor.
5. Só considerar retry automático depois de confirmar a causa. O erro observado
   foi marcado como `retryable: false`, portanto não deve ser repetido
   automaticamente com a configuração atual.

## Limites da conclusão

Está comprovado que a tentativa correlacionada recebeu HTTP 400 na chamada do
verificador. Ainda não está comprovado por que a Groq retornou esse status. Uma
nova chamada não repetiu o HTTP 400 e falhou posteriormente por parecer inválido,
o que impede atribuir o problema a indisponibilidade geral do provedor.

O encerramento anterior do VS Code foi causado separadamente por esgotamento de
memória e swap registrado pelo Linux. Não há evidência de relação causal entre o
OOM e o HTTP 400 da Groq.
