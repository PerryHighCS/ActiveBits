import { asRunIdentitySource, resolveRunToken } from '../shared/runIdentity.js'

/**
 * A draft-save payload's autosave-ordering counter: bumped on every
 * debounced save attempt, regardless of outcome. Distinct from
 * editSequence (a per-question domain "attempt N of answering this
 * question in this run" counter, tracked separately in
 * ResonanceStudent.tsx) — draftGeneration exists purely to order
 * network delivery of saves for the same question+run, and is meaningful
 * even across multiple saves of the identical answer.
 */
export function resolveDraftGeneration(payload: Record<string, unknown>): number {
  return typeof payload.draftGeneration === 'number' && Number.isSafeInteger(payload.draftGeneration) && payload.draftGeneration >= 0
    ? payload.draftGeneration
    : 0
}

/**
 * The key a draft-save payload is tracked under for retry/retained-draft
 * bookkeeping: the question it's for, plus the run it belongs to (or
 * `self-paced` when the payload identifies no active run at all).
 */
export function buildDraftRetryKey(payload: Record<string, unknown>): string | null {
  const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
  const runToken = resolveRunToken(asRunIdentitySource(payload))
  return questionId === null ? null : `${questionId}:${runToken ?? 'self-paced'}`
}
