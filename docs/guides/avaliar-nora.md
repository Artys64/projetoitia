# Avaliar a Nora

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

O corpus versionado fica em `tests/fixtures/nora-quality.json`. Ele separa casos
de desenvolvimento e validação reservada para reduzir ajustes orientados pelos
próprios casos usados na aprovação.

## Integridade local

```bash
npm run quality:corpus
npm run check:quality
npm run test:quality
```

Esses comandos verificam estrutura, cobertura, invariantes e código da avaliação
sem fazer chamadas pagas.

## Avaliação com provedor real

`scripts/evaluate-nora.mts` exige `GROQ_API_KEY` e realiza chamadas reais. Antes
de executá-lo, defina orçamento, modelo, versão do prompt, conjunto usado e
responsável pela revisão humana. Registre falhas técnicas separadamente de erros
semânticos; não conte recusas genéricas como respostas corretas.

Uma rodada deve registrar números absolutos e percentuais de respostas
fundamentadas, fontes corretas, invenções, ausência de orientação, bloqueios e
falhas do provedor. Se um caso reservado orientar uma correção, ele deixa de ser
uma validação independente e deve ser reposto antes da próxima aprovação.

Os resultados anteriores estão no
[arquivo de verificações](../archive/verification/README.md); não os trate como
aprovação do código ou modelo atual.
