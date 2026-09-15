import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadQualityCorpus, selectQualityCases, validateQualityCorpus } from '../scripts/lib/nora-quality.mjs'

test('corpus tem 40 casos, 80 rascunhos e divisão prévia representativa de 24/16', () => {
  const corpus = loadQualityCorpus()
  assert.equal(corpus.cases.length, 40)
  assert.equal(corpus.cases.reduce((total, item) => total + item.drafts.length, 0), 80)
  assert.equal(selectQualityCases(corpus).length, 24)
  assert.ok(selectQualityCases(corpus).every(item => item.split === 'development'))
  assert.equal(selectQualityCases(corpus, 'validation').length, 16)
  assert.equal(selectQualityCases(corpus, 'all').length, 40)
  assert.equal(corpus.evaluationPolicy.validationStatus, 'reserved_not_evaluated')
})

test('referência preserva prompt, modelo, parâmetros e os cinco artigos da demonstração', () => {
  const { baseline, articles } = loadQualityCorpus()
  assert.equal(baseline.prompt.version, 'rag-agent-v3')
  assert.equal(baseline.model, 'openai/gpt-oss-20b')
  assert.deepEqual(baseline.parameters, {
    temperature: 0, maxOutputTokens: 1200, reasoningEffort: 'medium', parallelToolCalls: false,
    maxSearches: 2, maxSteps: 3, maxContextChunks: 4, maxContextChars: 5000, timeoutMs: 20000,
  })
  assert.equal(articles.filter(entry => entry.origin === 'demo_snapshot').length, 5)
})

test('regressões conhecidas rejeitam passo extra de senha e triagem de viagem externa', () => {
  const { cases } = loadQualityCorpus()
  const password = cases.find(item => item.id === 'covered-password-request')!
  const insurance = cases.find(item => item.id === 'scope-antarctica-insurance')!
  for (const item of [password, insurance]) {
    assert.ok(item.regression)
    assert.equal(item.split, 'development')
    assert.equal(item.drafts.find(draft => draft.id === 'incorrect')?.expectedDecision, 'reject')
  }
  assert.match(password.drafts.find(draft => draft.id === 'incorrect')!.text, /Abra o link e crie/)
  assert.deepEqual(insurance.acceptedSources, [])
  assert.ok(!insurance.acceptableResponseModes.includes('clarification'))
})

test('rejeita adulteração do texto exato da evidência e do snapshot de prompt', () => {
  const corpus = loadQualityCorpus()
  const wrongEvidence = structuredClone(corpus)
  wrongEvidence.evidence[0]!.text += ' Abra o link e escolha uma nova senha.'
  assert.throws(() => validateQualityCorpus(wrongEvidence), /Trecho divergente/)
  const wrongPrompt = structuredClone(corpus)
  wrongPrompt.baseline.prompt.text += ' instrução não versionada'
  assert.throws(() => validateQualityCorpus(wrongPrompt), /Hash do prompt divergente/)
  const wrongArticle = structuredClone(corpus)
  wrongArticle.articles[0]!.article.content += ' Passo posterior inventado.'
  assert.throws(() => validateQualityCorpus(wrongArticle), /Hash dos artigos de referência divergente/)
})

test('rejeita fonte aceita que não foi recuperada e referência de outra empresa', () => {
  const corpus = loadQualityCorpus()
  const notRetrieved = structuredClone(corpus)
  notRetrieved.cases[0]!.acceptedSources.push('support-hub/planos@1#0')
  assert.throws(() => validateQualityCorpus(notRetrieved), /fonte aceita não recuperada/)
  const crossTenant = structuredClone(corpus)
  const item = crossTenant.cases.find(entry => entry.id === 'integrity-tenant-isolation')!
  item.retrievedEvidence.push('outra-empresa/redefinir-senha@1#0')
  assert.throws(() => validateQualityCorpus(crossTenant), /evidência de outra empresa/)
})

test('não mistura versões ativas de um artigo nem aceita evidência indisponível', () => {
  const mixed = loadQualityCorpus()
  mixed.cases[0]!.availableArticles.push('support-hub/redefinir-senha@2')
  assert.throws(() => validateQualityCorpus(mixed), /Artigo duplicado/)
  const unavailable = loadQualityCorpus()
  unavailable.cases[0]!.retrievedEvidence.push('support-hub/redefinir-senha@2#0')
  assert.throws(() => validateQualityCorpus(unavailable), /evidência indisponível/)
})

test('falhas injetadas exigem erro técnico mesmo quando o rascunho isolado é correto', () => {
  const corpus = loadQualityCorpus()
  const faults = corpus.cases.filter(item => item.fault)
  assert.equal(faults.length, 2)
  for (const item of faults) {
    assert.deepEqual(item.acceptableResponseModes, ['technical_error'])
    assert.ok(item.drafts.some(draft => draft.expectedDecision === 'approve'))
  }
  faults[0]!.acceptableResponseModes.push('approved')
  assert.throws(() => validateQualityCorpus(corpus), /falha não pode publicar rascunho/)
})

test('detecta perda de critério, duplicação de caso e alteração acidental da divisão', () => {
  const missingCriterion = loadQualityCorpus()
  missingCriterion.cases[0]!.forbiddenClaims = []
  assert.throws(() => validateQualityCorpus(missingCriterion), /forbiddenClaims/)
  const duplicate = loadQualityCorpus()
  duplicate.cases[1]!.id = duplicate.cases[0]!.id
  assert.throws(() => validateQualityCorpus(duplicate), /Caso duplicado/)
  const wrongSplit = loadQualityCorpus()
  wrongSplit.cases[0]!.split = 'validation'
  assert.throws(() => validateQualityCorpus(wrongSplit))
})
