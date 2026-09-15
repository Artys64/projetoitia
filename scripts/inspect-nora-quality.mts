import { readFileSync } from 'node:fs'
import { instructionsFor, PROMPT_VERSION } from '../apps/api/src/ia/prompts/nora.js'
import { loadArticles } from '../apps/api/src/ia/knowledge/repository.js'
import { loadQualityCorpus, selectQualityCases, sha256, type Split } from './lib/nora-quality.mjs'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && !/^--split=(development|validation|all)$/.test(args[0]!))) {
  throw new Error('Uso: npm run quality:corpus -- [--split=development|validation|all]. Apenas inspeção local; não executa IA.')
}
const split = (args[0]?.slice('--split='.length) ?? 'development') as Split | 'all'
const corpus = loadQualityCorpus()
const selected = selectQualityCases(corpus, split)
const snapshot = corpus.articles.filter(entry => entry.origin === 'demo_snapshot').map(entry => entry.article)
const generatorText = readFileSync(new URL('../apps/api/src/ia/agents/nora.ts', import.meta.url), 'utf8')
console.info(JSON.stringify({
  corpusVersion: corpus.corpusVersion,
  integrity: 'passed',
  semanticEvaluation: 'not_run',
  externalCalls: 0,
  split,
  selectedCases: selected.length,
  draftProbes: selected.reduce((total, item) => total + item.drafts.length, 0),
  categories: Object.fromEntries(Object.keys(corpus.categoryCounts).map(category => [category, selected.filter(item => item.category === category).length])),
  validationStatus: corpus.evaluationPolicy.validationStatus,
  baseline: {
    commit: corpus.baseline.gitCommit,
    promptVersion: corpus.baseline.prompt.version,
    model: corpus.baseline.model,
    parameters: corpus.baseline.parameters,
    articleSnapshotSha256: sha256(JSON.stringify(snapshot)),
    promptSha256: corpus.baseline.prompt.sha256,
    generatorSha256: corpus.baseline.generatorSha256,
  },
  currentMatchesBaseline: {
    articles: JSON.stringify(loadArticles()) === JSON.stringify(snapshot),
    prompt: PROMPT_VERSION === corpus.baseline.prompt.version && sha256(instructionsFor()) === corpus.baseline.prompt.sha256,
    generator: sha256(generatorText) === corpus.baseline.generatorSha256,
  },
  note: 'Integridade não mede qualidade das respostas. Divergência da referência indica mudança local; não substitua o snapshot histórico. O conjunto reservado não deve orientar ajustes.',
}, null, 2))
