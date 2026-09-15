import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from 'ai'
import { CallDeadlineError, PUBLICATION_MARGIN_MS, RESPONSE_TIMEOUT_MS, VERIFICATION_TIMEOUT_MS, requireTime, withinDeadline } from './deadline.js'
import { VERIFICATION_PROMPT_VERSION, verificationInstructions } from './prompts/verification.js'
import { decidePublication, validateVerificationInput, verificationSchema, type Publication, type VerificationFailureCode, type VerificationInput, type VerificationVerdict } from './verification.js'
import { sumUsage } from './usage.js'

export type VerificationAudit = {
  promptVersion: string
  model: string | null
  durationMs: number
  usage: LanguageModelUsage | null
  decision: VerificationVerdict['decision'] | null
  reasons: VerificationVerdict['reasons']
  failureCode: VerificationFailureCode | null
}

/** One structured call, without tools, SDK retries, repair calls or generated fallbacks. */
export async function verifyNoraDraft(options: {
  model: LanguageModel
  input: VerificationInput
  deadlineAt: number
}): Promise<{ publication: Publication; audit: VerificationAudit }> {
  const started = Date.now()

  const audit: VerificationAudit = {
    promptVersion: VERIFICATION_PROMPT_VERSION, model: null, durationMs: 0,
    usage: null, decision: null, reasons: [], failureCode: null,
  }
  const finish = (publication: Publication) => {
    audit.durationMs = Date.now() - started
    if (publication.status === 'blocked') audit.failureCode = publication.code
    return { publication, audit }
  }

  let input: VerificationInput
  try {
    input = structuredClone(options.input)
    validateVerificationInput(input)
  } catch { return finish({ status: 'blocked', code: 'invalid_input' }) }
  try {

    const absoluteDeadline = Math.min(options.deadlineAt, started + RESPONSE_TIMEOUT_MS)
    requireTime(absoluteDeadline, VERIFICATION_TIMEOUT_MS + PUBLICATION_MARGIN_MS)

    const result = await withinDeadline(Math.min(Date.now() + VERIFICATION_TIMEOUT_MS, absoluteDeadline - PUBLICATION_MARGIN_MS), abortSignal => generateText({
      model: options.model,
      system: verificationInstructions(),
      prompt: JSON.stringify({
        companyId: input.companyId,
        question: input.messages.at(-1)!.content,
        history: input.messages.slice(0, -1),
        draft: input.draft,
        evidence: input.evidence,
      }),
      
      output: Output.object({ name: 'nora_verification', schema: verificationSchema }),
      temperature: 0,
      maxOutputTokens: 3000,
      maxRetries: 0,
      abortSignal,
    }))
    
    audit.model = result.response.modelId
    audit.usage = sumUsage(result.totalUsage)
    if (result.finishReason !== 'stop' || result.toolCalls.length !== 0 || result.steps.length !== 1) {
      return finish({ status: 'blocked', code: 'invalid_verdict' })
    }
    const verdict = result.output
    audit.decision = verdict.decision
    audit.reasons = verdict.reasons
    return finish(decidePublication(input, verdict))
  } catch (error) {

    if (error instanceof CallDeadlineError) return finish({ status: 'blocked', code: error.code })

    if (NoObjectGeneratedError.isInstance(error)) {
      audit.usage = error.usage ? sumUsage(error.usage) : null
      audit.model = error.response?.modelId ?? null
      return finish({ status: 'blocked', code: 'invalid_verdict' })
    }

    if (NoOutputGeneratedError.isInstance(error)) return finish({ status: 'blocked', code: 'invalid_verdict' })
    // Provider errors may contain request bodies, drafts or raw responses. Never return or log them.
    return finish({ status: 'blocked', code: 'unavailable' })
  }
}
