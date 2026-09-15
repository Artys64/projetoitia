import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { validateArticles, type Article } from '../../apps/api/src/ia/knowledge/repository.js'
import { splitContent } from '../../apps/api/src/ia/knowledge/search.js'

export const corpusUrl = new URL('../../tests/fixtures/nora-quality.json', import.meta.url)
export const categoryCounts = {
  covered: 6, partial: 6, history: 6, uncovered: 4, out_of_scope: 4,
  social_mixed: 4, contradictions: 4, integrity: 6,
} as const
export type Split = 'development' | 'validation'
type ResponseMode = 'approved' | 'literal' | 'no_guidance' | 'out_of_scope' | 'clarification' | 'technical_error'
type Reason = 'unsupported_claim' | 'irrelevant_answer' | 'out_of_scope' | 'history_mismatch' | 'action_not_available'
export type QualityCase = {
  id: string
  category: keyof typeof categoryCounts
  split: Split
  companyId: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  question: string
  availableArticles: string[]
  retrievedEvidence: string[]
  acceptedSources: string[]
  allowedClaims: string[]
  requiredBehaviors: string[]
  forbiddenClaims: string[]
  acceptableResponseModes: ResponseMode[]
  drafts: Array<{ id: string; text: string; expectedDecision: 'approve' | 'reject' | 'uncertain'; reasons: Reason[] }>
  fault?: { stage: 'evaluation'; kind: 'unknown_source'; reference: string } |
    { stage: 'before_commit'; kind: 'unpublish_source'; articleSnapshotId: string }
  regression?: string
  untrustedCompanyId?: string
  reviewNote?: string
}
export type QualityCorpus = {
  schemaVersion: 1
  corpusVersion: string
  createdAt: string
  dataPolicy: 'synthetic_only'
  baseline: {
    gitCommit: string
    articlePath: string
    articleSnapshotSha256: string
    promptPath: string
    generatorPath: string
    prompt: { version: string; text: string; sha256: string }
    generatorSha256: string
    provider: string
    model: string
    parameters: {
      temperature: number; maxOutputTokens: number; reasoningEffort: string; parallelToolCalls: boolean
      maxSearches: number; maxSteps: number; maxContextChunks: number; maxContextChars: number; timeoutMs: number
    }
  }
  evaluationPolicy: {
    developmentCases: number; validationCases: number; validationStatus: string
    semanticJudgment: string; draftJudgment: string; validationReuse: string
    exactMatch: string; sourcePolicy: string; technicalFailures: string
  }
  fixedResponses: { no_guidance: string; out_of_scope: string; clarification: string }
  categoryCounts: typeof categoryCounts
  articles: Array<{ snapshotId: string; origin: 'demo_snapshot' | 'synthetic'; article: Article }>
  evidence: Array<{ id: string; articleSnapshotId: string; chunk: number; text: string }>
  cases: QualityCase[]
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function nonempty(value: unknown, label: string): asserts value is string {
  assert.ok(typeof value === 'string' && value.trim().length > 0, `${label}: texto obrigatório`)
}

function strings(value: unknown, label: string, min = 0): asserts value is string[] {
  assert.ok(Array.isArray(value) && value.length >= min, `${label}: lista inválida`)
  value.forEach(item => nonempty(item, label))
  assert.equal(new Set(value).size, value.length, `${label}: itens duplicados`)
}

/** Checks fixture integrity only. This is not a semantic verifier or a quality score. */
export function validateQualityCorpus(input: unknown): QualityCorpus {
  assert.ok(input && typeof input === 'object', 'Corpus inválido')
  // All fields consumed below are checked before the validated corpus is returned.
  const corpus = input as QualityCorpus
  assert.equal(corpus.schemaVersion, 1, 'Versão de schema desconhecida')
  nonempty(corpus.corpusVersion, 'corpusVersion')
  assert.match(corpus.createdAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(corpus.dataPolicy, 'synthetic_only')
  assert.deepEqual(corpus.categoryCounts, categoryCounts)
  const baseline = corpus.baseline
  assert.ok(baseline && baseline.prompt && baseline.parameters, 'Referência obrigatória')
  assert.match(baseline.gitCommit, /^[a-f0-9]{40}$/)
  for (const field of ['articlePath', 'promptPath', 'generatorPath', 'provider', 'model'] as const) nonempty(baseline[field], field)
  nonempty(baseline.prompt.version, 'Versão do prompt')
  nonempty(baseline.prompt.text, 'Snapshot do prompt')
  assert.equal(baseline.prompt.sha256, sha256(baseline.prompt.text), 'Hash do prompt divergente')
  assert.match(baseline.generatorSha256, /^[a-f0-9]{64}$/)
  for (const field of ['maxOutputTokens', 'maxSearches', 'maxSteps', 'maxContextChunks', 'maxContextChars', 'timeoutMs'] as const) {
    assert.ok(Number.isSafeInteger(baseline.parameters[field]) && baseline.parameters[field] > 0, `Parâmetro inválido: ${field}`)
  }
  assert.ok(Number.isFinite(baseline.parameters.temperature) && baseline.parameters.temperature >= 0)
  nonempty(baseline.parameters.reasoningEffort, 'reasoningEffort')
  assert.equal(typeof baseline.parameters.parallelToolCalls, 'boolean')
  const policy = corpus.evaluationPolicy
  assert.ok(policy, 'Política de avaliação obrigatória')
  assert.equal(policy.developmentCases, 24)
  assert.equal(policy.validationCases, 16)
  for (const field of ['validationStatus', 'semanticJudgment', 'draftJudgment', 'validationReuse', 'exactMatch', 'sourcePolicy', 'technicalFailures'] as const) nonempty(policy[field], field)
  assert.ok(corpus.fixedResponses, 'Mensagens fixas obrigatórias')
  for (const mode of ['no_guidance', 'out_of_scope', 'clarification'] as const) nonempty(corpus.fixedResponses[mode], mode)

  assert.ok(Array.isArray(corpus.articles) && corpus.articles.length > 0, 'Snapshots obrigatórios')
  const articles = new Map<string, Article>()
  for (const entry of corpus.articles) {
    validateArticles([entry.article])
    assert.ok(['demo_snapshot', 'synthetic'].includes(entry.origin), 'Origem inválida')
    const article = entry.article
    assert.equal(entry.snapshotId, `${article.companyId}/${article.id}@${article.version}`, 'Identidade do snapshot divergente')
    assert.ok(!articles.has(entry.snapshotId), `Snapshot duplicado: ${entry.snapshotId}`)
    articles.set(entry.snapshotId, article)
  }
  const demoSnapshot = corpus.articles.filter(entry => entry.origin === 'demo_snapshot').map(entry => entry.article)
  assert.equal(corpus.baseline.articleSnapshotSha256, sha256(JSON.stringify(demoSnapshot)), 'Hash dos artigos de referência divergente')
  assert.ok(Array.isArray(corpus.evidence), 'Evidências obrigatórias')
  const evidence = new Map<string, QualityCorpus['evidence'][number]>()
  for (const entry of corpus.evidence) {
    const article = articles.get(entry.articleSnapshotId)
    assert.ok(article, `Artigo inexistente: ${entry.articleSnapshotId}`)
    assert.ok(Number.isSafeInteger(entry.chunk) && entry.chunk >= 0, 'Chunk inválido')
    nonempty(entry.text, 'Texto da evidência')
    assert.equal(entry.text, splitContent(article.content)[entry.chunk], `Trecho divergente: ${entry.id}`)
    assert.equal(entry.id, `${entry.articleSnapshotId}#${entry.chunk}`, 'Identidade da evidência divergente')
    assert.ok(!evidence.has(entry.id), `Evidência duplicada: ${entry.id}`)
    evidence.set(entry.id, entry)
  }

  assert.ok(Array.isArray(corpus.cases), 'Casos obrigatórios')
  assert.equal(corpus.cases.length, 40, 'O corpus inicial precisa de 40 casos')
  const caseIds = new Set<string>()
  const responseModes: ResponseMode[] = ['approved', 'literal', 'no_guidance', 'out_of_scope', 'clarification', 'technical_error']
  const reasons: Reason[] = ['unsupported_claim', 'irrelevant_answer', 'out_of_scope', 'history_mismatch', 'action_not_available']
  for (const item of corpus.cases) {
    nonempty(item.id, 'Identificador do caso')
    assert.ok(!caseIds.has(item.id), `Caso duplicado: ${item.id}`)
    caseIds.add(item.id)
    assert.ok(Object.hasOwn(categoryCounts, item.category), `${item.id}: categoria inválida`)
    assert.ok(['development', 'validation'].includes(item.split), `${item.id}: divisão inválida`)
    nonempty(item.companyId, `${item.id}: empresa`)
    nonempty(item.question, `${item.id}: pergunta`)
    assert.ok(Array.isArray(item.history), `${item.id}: histórico obrigatório`)
    for (const message of item.history) {
      assert.ok(['user', 'assistant'].includes(message.role), `${item.id}: papel inválido no histórico`)
      nonempty(message.content, `${item.id}: histórico`)
    }
    strings(item.availableArticles, `${item.id}: artigos disponíveis`)
    const activeArticles: Article[] = []
    for (const id of item.availableArticles) {
      const article = articles.get(id)
      assert.ok(article, `${item.id}: snapshot inexistente ${id}`)
      activeArticles.push(article)
    }
    // Two versions may exist in the corpus, but not as the active version of one article in one scenario.
    validateArticles(activeArticles)
    strings(item.retrievedEvidence, `${item.id}: evidências recuperadas`)
    for (const id of item.retrievedEvidence) {
      const entry = evidence.get(id)
      assert.ok(entry, `${item.id}: evidência inexistente ${id}`)
      assert.ok(item.availableArticles.includes(entry.articleSnapshotId), `${item.id}: evidência indisponível`)
      const article = articles.get(entry.articleSnapshotId)!
      assert.equal(article.companyId, item.companyId, `${item.id}: evidência de outra empresa`)
      assert.equal(article.status, 'published', `${item.id}: evidência não publicada`)
    }
    strings(item.acceptedSources, `${item.id}: fontes aceitas`)
    assert.ok(item.acceptedSources.every(id => item.retrievedEvidence.includes(id)), `${item.id}: fonte aceita não recuperada`)
    for (const field of ['allowedClaims', 'requiredBehaviors', 'forbiddenClaims'] as const) strings(item[field], `${item.id}: ${field}`, 1)
    strings(item.acceptableResponseModes, `${item.id}: modos de resposta`, 1)
    assert.ok(item.acceptableResponseModes.every(mode => responseModes.includes(mode)), `${item.id}: modo inválido`)
    if (item.acceptableResponseModes.includes('literal')) assert.ok(item.acceptedSources.length > 0, `${item.id}: alternativa literal sem fonte`)
    assert.ok(Array.isArray(item.drafts) && item.drafts.length >= 2, `${item.id}: rascunhos corretos e incorretos obrigatórios`)
    const draftIds = new Set<string>()
    for (const draft of item.drafts) {
      nonempty(draft.id, `${item.id}: identificador do rascunho`)
      assert.ok(!draftIds.has(draft.id), `${item.id}: rascunho duplicado`)
      draftIds.add(draft.id)
      nonempty(draft.text, `${item.id}: texto do rascunho`)
      assert.ok(['approve', 'reject', 'uncertain'].includes(draft.expectedDecision), `${item.id}: decisão inválida`)
      strings(draft.reasons, `${item.id}: motivos`)
      assert.ok(draft.reasons.every(reason => reasons.includes(reason)), `${item.id}: motivo inválido`)
      assert.equal(draft.reasons.length === 0, draft.expectedDecision === 'approve', `${item.id}: motivos incompatíveis com decisão`)
    }
    assert.ok(item.drafts.some(draft => draft.expectedDecision === 'approve'), `${item.id}: falta rascunho correto`)
    assert.ok(item.drafts.some(draft => draft.expectedDecision === 'reject'), `${item.id}: falta erro inserido`)
    if (item.fault) {
      assert.deepEqual(item.acceptableResponseModes, ['technical_error'], `${item.id}: falha não pode publicar rascunho`)
      assert.deepEqual(item.acceptedSources, [], `${item.id}: falha não pode publicar fonte`)
      if (item.fault.kind === 'unknown_source') {
        assert.equal(item.fault.stage, 'evaluation')
        nonempty(item.fault.reference, `${item.id}: referência forjada`)
        assert.ok(!evidence.has(item.fault.reference), `${item.id}: referência forjada existe`)
      } else {
        assert.equal(item.fault.kind, 'unpublish_source', `${item.id}: falha desconhecida`)
        assert.equal(item.fault.stage, 'before_commit')
        const invalidatedSnapshot = item.fault.articleSnapshotId
        assert.ok(item.retrievedEvidence.some(id => evidence.get(id)?.articleSnapshotId === invalidatedSnapshot), `${item.id}: fonte invalidada não foi recuperada`)
      }
      nonempty(item.reviewNote, `${item.id}: instruções para falha obrigatórias`)
    }
    for (const field of ['regression', 'untrustedCompanyId', 'reviewNote'] as const) {
      if (item[field] !== undefined) nonempty(item[field], `${item.id}: ${field}`)
    }
  }
  for (const [category, count] of Object.entries(categoryCounts)) {
    const items = corpus.cases.filter(item => item.category === category)
    assert.equal(items.length, count, `Contagem da categoria ${category}`)
    for (const split of ['development', 'validation']) assert.ok(items.some(item => item.split === split), `${category}: falta representação em ${split}`)
  }
  assert.equal(corpus.cases.filter(item => item.split === 'development').length, policy.developmentCases)
  assert.equal(corpus.cases.filter(item => item.split === 'validation').length, policy.validationCases)
  return corpus
}

export function loadQualityCorpus(url: URL = corpusUrl): QualityCorpus {
  return validateQualityCorpus(JSON.parse(readFileSync(url, 'utf8')))
}

export function selectQualityCases(corpus: QualityCorpus, split: Split | 'all' = 'development'): QualityCase[] {
  assert.ok(['development', 'validation', 'all'].includes(split), 'Divisão desconhecida')
  return corpus.cases.filter(item => split === 'all' || item.split === split)
}
