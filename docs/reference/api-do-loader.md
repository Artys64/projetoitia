# API pública do loader

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

Depois do evento `load` de `loader.js`, `window.SupportHub` oferece:

| Método | Efeito |
| --- | --- |
| `open()` | Abre o widget; aguarda `ready` quando necessário. |
| `close()` | Fecha o widget e devolve o foco ao acionador. |
| `on(event, callback)` | Registra um listener. |
| `off(event, callback)` | Remove exatamente o listener informado. |

## Eventos

| Evento | Payload |
| --- | --- |
| `ready` | `{ installationId }` |
| `opened` | objeto vazio |
| `closed` | `{ reason: 'command' \| 'dismiss' }` |
| `error` | `{ code, message }` |

Eventos não são armazenados para listeners registrados depois. Antes de
`ready`, o loader aceita uma fila limitada de comandos. O handshake expira em
dez segundos. Uma falha fatal remove botão e iframe, mas mantém a API disponível
para informar indisponibilidade.

Repetir o mesmo snippet mantém uma única instância. Outro ID gera
`installation_conflict`; um `window.SupportHub` preexistente gera
`global_conflict`. Falhas anteriores à criação da API também são publicadas no
evento global `supporthub:error`.

Os envelopes internos usam protocolo versão 1 e são definidos em
`packages/contracts/src/index.ts`. Eles não fazem parte da API que o host deve
montar manualmente.
