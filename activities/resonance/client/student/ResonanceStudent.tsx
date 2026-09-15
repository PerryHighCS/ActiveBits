import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useResonanceSession } from '../hooks/useResonanceSession.js'
import NameEntryForm from './NameEntryForm.js'
import QuestionView from './QuestionView.js'
import SharedResponseFeed from './SharedResponseFeed.js'
import { areMcqSelectionsEqual } from '../../shared/mcq.js'
import { asRunIdentitySource, payloadMatchesResolvedRunToken, resolveRunToken, runIdentitiesMatch, type RunIdentitySource } from '../../shared/runIdentity.js'
import { buildDraftRetryKey, resolveDraftGeneration } from '../draftAttempt.js'
import type { AnswerPayload } from '../../shared/types.js'

interface RegisterResponse {
  studentId?: string
  name?: string
  error?: string
}

interface SubmissionAnnouncement {
  id: number
  message: string
}

interface UnconfirmedDraft {
  payload: Record<string, unknown>
  retrying: boolean
  deadlineAt: number | null
}

/**
 * Per-question state that survives a QuestionView remount (that component
 * is deliberately remounted on every stack-tab switch). Consolidates what
 * used to be six separately-keyed refs/maps that had to be kept in sync by
 * hand — see .agent/plans/resonance-draft-state-consolidation.md. Keyed by
 * questionId alone: a run transition updates fields on the existing entry
 * in place rather than requiring values to be copied across a second key
 * namespace.
 *
 * None of these fields (other than runToken itself) are trustworthy on
 * their own — a composite `questionId:runToken` key used to make a run
 * transition reset them *implicitly*, just by being a different string.
 * Collapsed into one record, every read must instead check `runToken`
 * against the run it's being asked about (see the `getQuestion*` readers
 * below, which fall back to the same baseline a missing composite-key
 * entry would have produced). Writes go through
 * ensureQuestionDraftStateForRun, which only resets when the record's
 * `runToken` doesn't already match — so a same-run write is a plain
 * in-place mutation, and only a genuine transition starts fresh.
 */
export interface QuestionDraftState {
  /** Which run this record currently represents. Always trustworthy as-is — this is what every other field is scoped to. */
  runToken: number | null
  /** Highest draftGeneration attempted so far for this run (see nextDraftGeneration). */
  attemptedGeneration: number
  /** Highest draftGeneration the server has acknowledged for this run. */
  acknowledgedGeneration: number
  /** A failed autosave retained for retry, or null if nothing is outstanding. */
  unconfirmedDraft: UnconfirmedDraft | null
  /** "Attempt N of answering this question in this run" — advances on a revisit, never resets on its own (see advanceQuestionEditSequenceForRevisit). Baseline 1. */
  editSequence: number
  /** The editSequence that was actually confirmed submitted for this run, or null if nothing has been confirmed yet. */
  submittedEditSequence: number | null
}

function freshQuestionDraftState(runToken: number | null): QuestionDraftState {
  return {
    runToken,
    attemptedGeneration: 0,
    acknowledgedGeneration: 0,
    unconfirmedDraft: null,
    editSequence: 1,
    submittedEditSequence: null,
  }
}

/**
 * Returns the record for `questionId`, resetting it first if it exists but
 * represents a different run than `runToken` — the one place a genuine run
 * transition is detected and applied. Every writer below goes through
 * this; canonicalizeQuestionRunToken is the deliberate exception (a
 * same-run relabeling, not a transition — see its own comment).
 */
function ensureQuestionDraftStateForRun(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): QuestionDraftState {
  const existing = questionDraftStateByQuestionId.get(questionId)
  if (existing !== undefined && existing.runToken === runToken) return existing
  const fresh = freshQuestionDraftState(runToken)
  questionDraftStateByQuestionId.set(questionId, fresh)
  return fresh
}

export function getQuestionRunToken(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
): number | null | undefined {
  return questionDraftStateByQuestionId.get(questionId)?.runToken
}

export function setQuestionRunToken(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): void {
  ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
}

// Used only when canonicalizing a legacy (pre-revision) run token to its
// revision-1 form for the SAME real run (see canonicalizeLegacyRevisionOneDraft)
// — unlike setQuestionRunToken, this must preserve every other field: it's
// not a new run, just a different representation of the one already
// recorded.
export function canonicalizeQuestionRunToken(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number,
): void {
  const existing = questionDraftStateByQuestionId.get(questionId)
  if (existing) {
    existing.runToken = runToken
  } else {
    questionDraftStateByQuestionId.set(questionId, freshQuestionDraftState(runToken))
  }
}

export function nextQuestionDraftGeneration(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.attemptedGeneration += 1
  return state.attemptedGeneration
}

export function getQuestionAttemptedGeneration(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number {
  const state = questionDraftStateByQuestionId.get(questionId)
  return state !== undefined && state.runToken === runToken ? state.attemptedGeneration : 0
}

// Raises attemptedGeneration's floor to at least `generation` — used to
// seed it from the server's own record on every snapshot, the same way a
// post-reload local counter needs a floor so it doesn't collide with (or
// trail) generations the server has already seen for this run.
export function seedQuestionAttemptedGeneration(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
  generation: number,
): void {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.attemptedGeneration = Math.max(state.attemptedGeneration, generation)
}

export function getQuestionUnconfirmedDraft(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): UnconfirmedDraft | null {
  const state = questionDraftStateByQuestionId.get(questionId)
  return state !== undefined && state.runToken === runToken ? state.unconfirmedDraft : null
}

export function setQuestionUnconfirmedDraft(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
  draft: UnconfirmedDraft | null,
): void {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.unconfirmedDraft = draft
}

// A failure payload can still be in legacy (timestamp-only) form after this
// question's QuestionDraftState record has already moved to a revision
// number for the same real run (e.g. the retry loop's own canonicalization
// ran first). Every read/write above compares by strict equality against
// state.runToken, so a legacy-form runToken would look like a different run
// entirely — missing the real acknowledged/attempted watermarks, and
// wiping the record via setQuestionUnconfirmedDraft's reset-on-mismatch.
// If an existing record's runToken is equivalent to this payload's own
// identity (payloadMatchesResolvedRunToken recognizes the legacy/canonical
// bridge a raw === can't), reuse the record's own runToken for every
// subsequent read/write instead of re-resolving from the payload —
// guaranteeing they agree by construction, regardless of whether some
// other signal (like the current snapshot) has moved ahead of what this
// record reflects yet. Falls back to resolving from the payload directly
// when there's no existing record, or it genuinely belongs to a different
// run — the same cases setQuestionRunToken already treats as fresh.
export function resolveQuestionRunTokenForPayload(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  payload: Record<string, unknown>,
): number | null {
  const existing = questionDraftStateByQuestionId.get(questionId)
  return existing !== undefined && payloadMatchesResolvedRunToken(payload, existing.runToken)
    ? existing.runToken
    : resolvePayloadRunToken(payload)
}

export function getQuestionAcknowledgedGeneration(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number {
  const state = questionDraftStateByQuestionId.get(questionId)
  return state !== undefined && state.runToken === runToken ? state.acknowledgedGeneration : 0
}

// An ack (from a direct save or a hook-level reconnect replay) only ever
// names a specific (questionId, run) pair — never "the current run,
// whatever that is now" — since it can arrive long after that run has
// ended. `runIdentity` is the run identity the *ack itself* names, which
// for a delayed reconnect-replay ack can still be in legacy (timestamp-only)
// form even after the local record has since been canonicalized to a
// revision number for the same real run — payloadMatchesResolvedRunToken
// (not a raw ===) is what recognizes that as the same run rather than
// rejecting the ack as stale. Refuses to touch an EXISTING record for a
// genuinely different run (that record now belongs to a later run and this
// ack has nothing to say about it), but will still create a fresh one if
// none exists yet, matching the old acknowledgedDraftGenerationByKeyRef's
// behavior of recording an acknowledgement independently of whether
// anything was retained. Returns whether a retained draft was cleared, so
// the caller can skip an unnecessary re-render when nothing changed.
export function acknowledgeQuestionDraftGeneration(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runIdentity: RunIdentitySource,
  generation: number,
): boolean {
  const existing = questionDraftStateByQuestionId.get(questionId)
  if (existing !== undefined && !payloadMatchesResolvedRunToken(runIdentity, existing.runToken)) return false
  const runToken = existing?.runToken ?? resolveRunToken(runIdentity)
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.acknowledgedGeneration = Math.max(state.acknowledgedGeneration, generation)
  if (state.unconfirmedDraft !== null && resolveDraftGeneration(state.unconfirmedDraft.payload) <= generation) {
    state.unconfirmedDraft = null
    return true
  }
  return false
}

const UNCONFIRMED_DRAFT_RETRY_INTERVAL_MS = 1_000

interface UnconfirmedDraftContext {
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionRunRevision: number | null
  activeQuestionDeadlineAt: number | null
  lastActiveQuestionRunRevision?: number | null
  submittedResponseEditSequences?: Record<string, number>
}

function isAnswerPayload(value: unknown): value is AnswerPayload {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type === 'free-response') return typeof record.text === 'string'
  if (record.type === 'multiple-choice') {
    return Array.isArray(record.selectedOptionIds) && record.selectedOptionIds.every((id) => typeof id === 'string')
  }
  return false
}

// MCQ answers are set-based (see QuestionView.tsx's isSameAnswer and
// shared/mcq.ts) — selectedOptionIds order carries no meaning, so a
// retained draft and its confirmed submission can hold the same selection
// in a different array order (e.g. a different click order). A raw
// JSON.stringify comparison would treat those as different and the draft
// would never reconcile against its own submission, retrying forever.
export function isSameDraftAnswer(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!isAnswerPayload(left) || !isAnswerPayload(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  if (left.type !== right.type) return false
  return left.type === 'free-response'
    ? right.type === 'free-response' && left.text === right.text
    : right.type === 'multiple-choice' && areMcqSelectionsEqual(left.selectedOptionIds, right.selectedOptionIds)
}

function resolvePayloadRunToken(payload: Record<string, unknown>): number | null {
  return resolveRunToken(asRunIdentitySource(payload))
}

// A timestamp-only payload can identify only the original numbered run.
// The server maps that legacy form to revision 1, including after expiry
// when the active start timestamp is no longer present in the snapshot.
// See payloadMatchesResolvedRunToken in shared/runIdentity.ts.
export function payloadMatchesRunToken(payload: Record<string, unknown>, runToken: number | null): boolean {
  return payloadMatchesResolvedRunToken(asRunIdentitySource(payload), runToken)
}

// See buildDraftRetryKey in client/draftAttempt.ts. Kept under this name
// (and exported from here) since it's part of this component's own public
// test surface.
export function buildUnconfirmedDraftKey(payload: Record<string, unknown>): string | null {
  return buildDraftRetryKey(payload)
}

// Normalize the sole legacy run form that the server accepts after revision
// rollout. Once retained locally, use revision 1 everywhere so retry keys,
// acknowledgements, and post-expiry reconciliation share one identity.
export function canonicalizeLegacyRevisionOneDraft(
  payload: Record<string, unknown>,
  snapshot: Pick<UnconfirmedDraftContext, 'activeQuestionRunRevision' | 'activeQuestionRunStartedAt'>,
): Record<string, unknown> {
  return typeof payload.activeQuestionRunRevision !== 'number' &&
    snapshot.activeQuestionRunRevision === 1 &&
    payload.activeQuestionRunStartedAt === snapshot.activeQuestionRunStartedAt
    ? { ...payload, activeQuestionRunRevision: 1 }
    : payload
}

export function resolveUnconfirmedDraftDisposition(
  payload: Record<string, unknown>,
  snapshot: UnconfirmedDraftContext,
  studentId: string,
  now: number,
): 'discard' | 'reconcile' | 'retry' {
  const activeRunToken = snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt
  const payloadHasRevision = typeof payload.activeQuestionRunRevision === 'number'
  const payloadRunToken = payloadHasRevision
    ? payload.activeQuestionRunRevision as number
    : typeof payload.activeQuestionRunStartedAt === 'number'
      ? payload.activeQuestionRunStartedAt
      : null
  // The server accepts timestamp-only drafts from pre-revision clients for
  // the original numbered run (revision 1). Mirror that migration path in
  // the client retry owner so reconnect does not discard a still-valid draft.
  const isLegacyRevisionOneRun = !payloadHasRevision &&
    snapshot.activeQuestionRunRevision === 1 &&
    payloadRunToken === snapshot.activeQuestionRunStartedAt
  const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
  const isCurrentRun =
    payload.studentId === studentId &&
    (payloadRunToken === activeRunToken || isLegacyRevisionOneRun) &&
    questionId !== null &&
    snapshot.activeQuestionIds.includes(questionId)

  if (!isCurrentRun) return 'discard'

  // Self-paced runs have no deadline (and every question stays in
  // activeQuestionIds indefinitely), so without this a failed autosave for a
  // question the student already submitted and moved past would satisfy
  // isCurrentRun and read null deadline forever, keeping the 1-second retry
  // interval alive for a question that no longer needs it. A submission with
  // an editSequence at or above this draft's own means it has already been
  // superseded, in self-paced mode or a live run alike; a genuinely newer
  // local revision (higher editSequence) still gets retried normally.
  const confirmedEditSequence = questionId !== null ? snapshot.submittedResponseEditSequences?.[questionId] : undefined
  const payloadEditSequence = typeof payload.editSequence === 'number' ? payload.editSequence : 0
  if (confirmedEditSequence !== undefined && payloadEditSequence <= confirmedEditSequence) {
    return 'discard'
  }

  const capturedDeadlineAt = typeof payload.activeQuestionDeadlineAt === 'number'
    ? payload.activeQuestionDeadlineAt
    : null
  // A delayed snapshot can omit a deadline, but an authoritative snapshot
  // may also shorten it. Never continue retrying past either known bound.
  const deadlineAt = capturedDeadlineAt === null
    ? snapshot.activeQuestionDeadlineAt
    : snapshot.activeQuestionDeadlineAt === null
      ? capturedDeadlineAt
      : Math.min(capturedDeadlineAt, snapshot.activeQuestionDeadlineAt)
  return deadlineAt !== null && now >= deadlineAt
    ? 'reconcile'
    : 'retry'
}

export function shouldRetryRegistrationWithoutStudentId(status: number, studentId: string | null): boolean {
  return status === 403 && studentId !== null
}

export function resolveNextSelfPacedQuestionId(params: {
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string | null {
  const { questionIds, submittedQuestionIds, currentQuestionId } = params
  if (questionIds.length === 0) {
    return null
  }

  const currentIndex = currentQuestionId ? questionIds.indexOf(currentQuestionId) : -1
  const orderedCandidates = currentIndex >= 0
    ? [...questionIds.slice(currentIndex + 1), ...questionIds.slice(0, currentIndex + 1)]
    : questionIds

  const nextUnsubmitted = orderedCandidates.find((questionId) => !submittedQuestionIds.has(questionId))
  if (nextUnsubmitted) {
    return nextUnsubmitted
  }

  return currentIndex >= 0 ? currentQuestionId : questionIds[0] ?? null
}

export function clearLiveQuestionSubmission(params: {
  selfPacedMode: boolean
  submittedQuestionIds: Set<string>
  questionId: string
}): Set<string> {
  if (params.selfPacedMode || !params.submittedQuestionIds.has(params.questionId)) {
    return params.submittedQuestionIds
  }

  const next = new Set(params.submittedQuestionIds)
  next.delete(params.questionId)
  return next
}

// Per-question/run edit-sequence bookkeeping — "attempt N of answering this
// question in this run" — using the same read-time-validated
// QuestionDraftState pattern as the generation/draft fields above (see the
// type's own doc comment). `runToken` should be the same
// activeQuestionRunRevision ?? activeQuestionRunStartedAt value passed to
// QuestionView, so a new run naturally starts its own counter at the
// baseline.

export function resolveQuestionEditSequence(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number {
  const state = questionDraftStateByQuestionId.get(questionId)
  return state !== undefined && state.runToken === runToken ? state.editSequence : 1
}

export function advanceQuestionEditSequenceForRevisit(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.editSequence += 1
  return state.editSequence
}

/**
 * This in-memory counter has no local history to build on right after a page
 * reload, so it would otherwise default a post-reload revision to sequence 1
 * — colliding with (or trailing) a confirmed response the server already has
 * at sequence 1+, and having the revision silently dropped as stale by the
 * server's draft guard. Seed the counter from the server-confirmed response's
 * own editSequence (floor = confirmed + 1) whenever it would otherwise leave
 * a lower value in place; never lowers an already-advanced local counter.
 */
export function seedQuestionEditSequenceFromConfirmedResponse(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
  confirmedEditSequence: number,
): void {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.editSequence = Math.max(state.editSequence, confirmedEditSequence + 1)
}

export function getQuestionSubmittedEditSequence(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): number | null {
  const state = questionDraftStateByQuestionId.get(questionId)
  return state !== undefined && state.runToken === runToken ? state.submittedEditSequence : null
}

export function recordQuestionSubmittedEditSequence(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
  editSequence: number,
): void {
  const state = ensureQuestionDraftStateForRun(questionDraftStateByQuestionId, questionId, runToken)
  state.submittedEditSequence = editSequence
}

export function resolveQuestionAnswer(params: {
  localAnswers: Record<string, AnswerPayload | null>
  snapshotAnswers: Record<string, AnswerPayload>
  questionId: string
}): AnswerPayload | null {
  return Object.prototype.hasOwnProperty.call(params.localAnswers, params.questionId)
    ? params.localAnswers[params.questionId] ?? null
    : params.snapshotAnswers[params.questionId] ?? null
}

export function resolveSelfPacedSubmittedMessage(params: {
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string {
  const nextQuestionId = resolveNextSelfPacedQuestionId(params)
  const hasUnsubmittedQuestion = params.questionIds.some((questionId) => !params.submittedQuestionIds.has(questionId))

  if (!hasUnsubmittedQuestion) {
    return 'All questions completed.'
  }

  return nextQuestionId !== params.currentQuestionId
    ? 'Answer submitted. Moving to the next question.'
    : 'Answer submitted.'
}

export function resolveSubmissionAnnouncement(params: {
  selfPacedMode: boolean
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string | null {
  return params.selfPacedMode
    ? resolveSelfPacedSubmittedMessage(params)
    : null
}

export function resolveQuestionStatusBadge(selfPacedMode: boolean): {
  label: string
  dotClassName: string
} {
  return selfPacedMode
    ? {
        label: 'Self-paced',
        dotClassName: 'w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 inline-block',
      }
    : {
        label: 'Live Question',
        dotClassName: 'w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse motion-reduce:animate-none inline-block',
  }
}

export function hasActiveQuestionRunRestart(params: {
  hasObservedSnapshot: boolean
  activeQuestionIds: string[]
  activeQuestionRunRevision: number | null
  previousActiveQuestionRunRevision: number | null
  activeQuestionRunStartedAt: number | null
  previousActiveQuestionRunStartedAt: number | null
}): boolean {
  // A raw revision-first comparison treats a legacy-to-canonical migration
  // (previous: {revision: null, startedAt: T}, new: {revision: 1, startedAt:
  // T} — the same real run, just normalized) as a restart, wrongly clearing
  // local answers/submissions for a run that never actually ended. Use the
  // same equivalence shared/runIdentity.ts already uses for this bridge
  // everywhere else instead of a bespoke comparison here.
  const runChanged = !runIdentitiesMatch(
    { activeQuestionRunRevision: params.activeQuestionRunRevision, activeQuestionRunStartedAt: params.activeQuestionRunStartedAt },
    { activeQuestionRunRevision: params.previousActiveQuestionRunRevision, activeQuestionRunStartedAt: params.previousActiveQuestionRunStartedAt },
  )

  return (
    params.hasObservedSnapshot &&
    params.activeQuestionIds.length > 0 &&
    runChanged
  )
}

function formatRemainingTime(deadlineAt: number | null, now: number): string | null {
  if (deadlineAt === null) {
    return null
  }

  const remainingMs = Math.max(0, deadlineAt - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Main student-facing view for Resonance.
 *
 * Identity flow:
 * 1. Resolve identity from the platform waiting room (displayName field).
 * 2. If no name was collected (e.g. direct URL access), show NameEntryForm.
 * 3. Register with POST /api/resonance/:sessionId/register-student.
 * 4. Poll session state and show the active question + shared reveals.
 */
export default function ResonanceStudent() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  const [identityResolved, setIdentityResolved] = useState(false)
  const [studentName, setStudentName] = useState<string | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [submittedQuestionIds, setSubmittedQuestionIds] = useState<Set<string>>(new Set())
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, AnswerPayload | null>>({})
  const submittedAnswersRef = useRef<Record<string, AnswerPayload | null>>({})
  // Tracks which run each submittedAnswers entry was written under, so a
  // stale-run discard/reconcile (below) can require that context to match
  // instead of comparing answer content alone — two different runs can
  // legitimately contain the same answer text/selection.
  const questionDraftStateRef = useRef(new Map<string, QuestionDraftState>())
  const [draftResetVersions, setDraftResetVersions] = useState<Record<string, number>>({})
  const [submissionAnnouncement, setSubmissionAnnouncement] = useState<SubmissionAnnouncement | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  submittedAnswersRef.current = submittedAnswers

  const previousActiveQuestionIdsRef = useRef<string[]>([])
  const previousActiveQuestionRunRevisionRef = useRef<number | null>(null)
  const previousActiveQuestionRunStartedAtRef = useRef<number | null>(null)
  const hasObservedSnapshotRef = useRef(false)
  const [unconfirmedDraftVersion, setUnconfirmedDraftVersion] = useState(0)
  // Stable across countdown renders: QuestionView includes this callback in
  // its autosave effect dependencies, so an inline callback would flush the
  // 1500ms debounce on every timer tick.
  const nextDraftGeneration = useCallback((questionId: string, activeQuestionRunToken: number | null) => {
    return nextQuestionDraftGeneration(questionDraftStateRef.current, questionId, activeQuestionRunToken)
  }, [])

  // Shared by a direct successful save (handleDraftSaved, below) and a
  // reconnect-replay ack (passed to useResonanceSession as
  // onDraftReplayAcknowledged) — both are ways this component can learn a
  // particular generation is now durably persisted, and either should clear
  // a same-or-older retained entry rather than leaving it to keep retrying.
  const clearRetainedDraftIfSuperseded = useCallback((questionId: string | null, runIdentity: RunIdentitySource, generation: number) => {
    if (questionId === null) return
    if (acknowledgeQuestionDraftGeneration(questionDraftStateRef.current, questionId, runIdentity, generation)) {
      setUnconfirmedDraftVersion((current) => current + 1)
    }
  }, [])

  useLayoutEffect(() => {
    setIdentityResolved(false)
    setStudentName(null)
    setStudentId(null)
    setNameSubmitted(false)
    setRegistered(false)
    setRegisterError(null)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'resonance',
          sessionId,
          isSoloSession: false,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (cancelled) return

        setStudentName(identity.studentName)
        setStudentId(identity.studentId)
        setNameSubmitted(identity.nameSubmitted)
      } catch {
        // Identity resolution failing is non-fatal; fall through to NameEntryForm.
      } finally {
        if (!cancelled) setIdentityResolved(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !nameSubmitted || registered || studentName === null) return
    let cancelled = false

    void (async () => {
      try {
        const resp = await fetch(`/api/resonance/${sessionId}/register-student`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: studentName, studentId }),
        })

        const data = (await resp.json()) as RegisterResponse
        if (cancelled) return

        if (!resp.ok || !data.studentId) {
          if (shouldRetryRegistrationWithoutStudentId(resp.status, studentId)) {
            persistSessionParticipantIdentity(
              window.localStorage,
              sessionId,
              studentName,
              null,
            )
            setStudentId(null)
            setRegisterError(null)
            return
          }
          setRegisterError(data.error ?? 'Failed to join session')
          return
        }

        setStudentId(data.studentId)
        persistSessionParticipantIdentity(
          window.localStorage,
          sessionId,
          studentName,
          data.studentId,
        )
        setRegistered(true)
      } catch {
        if (!cancelled) setRegisterError('Network error — could not join session')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, nameSubmitted, registered, studentName, studentId])

  const { snapshot, loading: sessionLoading, error: sessionError, refresh, sendMessage, saveDraft, cancelDraftRetries } = useResonanceSession(
    registered && sessionId ? sessionId : null,
    studentId,
    { onDraftReplayAcknowledged: clearRetainedDraftIfSuperseded },
  )
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useLayoutEffect(() => {
    setSelectedQuestionId(null)
    setSubmittedQuestionIds(new Set())
    setSubmittedAnswers({})
    setDraftResetVersions({})
    setSubmissionAnnouncement(null)
    previousActiveQuestionIdsRef.current = []
    previousActiveQuestionRunRevisionRef.current = null
    previousActiveQuestionRunStartedAtRef.current = null
    hasObservedSnapshotRef.current = false
    questionDraftStateRef.current.clear()
    setUnconfirmedDraftVersion((current) => current + 1)
  }, [sessionId, studentId])

  const reconcileUnconfirmedDraft = useCallback((questionId: string, payload: Record<string, unknown>) => {
    if (!payloadMatchesRunToken(payload, getQuestionRunToken(questionDraftStateRef.current, questionId) ?? null)) return
    if (!isSameDraftAnswer(submittedAnswersRef.current[questionId], payload.answer)) return
    setSubmittedAnswers((current) => {
      const next = { ...current }
      delete next[questionId]
      return next
    })
    setDraftResetVersions((current) => ({
      ...current,
      [questionId]: (current[questionId] ?? 0) + 1,
    }))
    void refresh()
  }, [refresh])

  const discardUnconfirmedDraft = useCallback((questionId: string, payload: Record<string, unknown>) => {
    if (!payloadMatchesRunToken(payload, getQuestionRunToken(questionDraftStateRef.current, questionId) ?? null)) return
    setSubmittedAnswers((current) => {
      if (!isSameDraftAnswer(current[questionId], payload.answer)) return current
      const next = { ...current }
      delete next[questionId]
      return next
    })
  }, [])

  // A still-in-flight autosave (sent before a submission, failing after it —
  // e.g. the socket closes moments later) can reach recordUnconfirmedDraft
  // with a run/answer that still matches, since submission doesn't change
  // either. Without this it would resurrect an already-submitted draft
  // instead of being dropped as a no-op.
  const isPayloadSupersededBySubmission = useCallback((payload: Record<string, unknown>): boolean => {
    const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
    if (questionId === null) return false
    const submittedRunToken = getQuestionRunToken(questionDraftStateRef.current, questionId) ?? null
    if (!payloadMatchesRunToken(payload, submittedRunToken)) return false
    const payloadEditSequence = typeof payload.editSequence === 'number' ? payload.editSequence : 0
    const submittedEditSequence = getQuestionSubmittedEditSequence(questionDraftStateRef.current, questionId, submittedRunToken)
    return submittedEditSequence !== null && payloadEditSequence <= submittedEditSequence
  }, [])

  // Stable regardless of snapshot identity: QuestionView includes this
  // callback (as onDraftSaveFailed) in its autosave effect dependencies, so a
  // snapshot update while a debounce is pending would otherwise flush the
  // draft early. Read the fallback deadline from a ref instead of closing
  // over snapshot directly.
  const recordUnconfirmedDraft = useCallback((payload: Record<string, unknown>) => {
    const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
    if (questionId === null) return
    if (isPayloadSupersededBySubmission(payload)) return
    const runToken = resolveQuestionRunTokenForPayload(questionDraftStateRef.current, questionId, payload)
    // A failed save from an older run can arrive after the question has
    // already moved to a newer one. resolveQuestionRunTokenForPayload
    // correctly resolves it to that OLD run's own token (it's genuinely not
    // equivalent to the record's current run) — but every write below goes
    // through ensureQuestionDraftStateForRun, which would then repurpose
    // this same questionId record for that old token, wiping the newer
    // run's attempted/acknowledged generations and edit sequence out from
    // under it. This failure has nothing to say about the run the record
    // currently represents, so it's simply dropped rather than retained.
    const existingState = questionDraftStateRef.current.get(questionId)
    if (existingState !== undefined && existingState.runToken !== runToken) return
    const payloadGeneration = resolveDraftGeneration(payload)
    if (payloadGeneration <= getQuestionAcknowledgedGeneration(questionDraftStateRef.current, questionId, runToken)) return
    // A late failure from an unmounted view can arrive after a replacement
    // view (post-remount) has already attempted — but not yet resolved — a
    // newer save for the same question+run. Neither of the checks above
    // catches that: nothing has acknowledged the newer attempt yet, and
    // nothing is retained for it either, since it hasn't failed (or it may
    // still succeed and never need to be). Comparing against the highest
    // generation *attempted* so far (not just acknowledged or retained)
    // catches it without risk: if that newer attempt later fails too, it is
    // by then the highest attempted and retains itself correctly.
    if (payloadGeneration < getQuestionAttemptedGeneration(questionDraftStateRef.current, questionId, runToken)) return
    const current = getQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken)
    if (current && resolveDraftGeneration(current.payload) > payloadGeneration) return
    const deadlineAt = typeof payload.activeQuestionDeadlineAt === 'number'
      ? payload.activeQuestionDeadlineAt
      : snapshotRef.current?.activeQuestionDeadlineAt ?? null
    setQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken, { payload, retrying: false, deadlineAt })
    setUnconfirmedDraftVersion((current) => current + 1)
  }, [isPayloadSupersededBySubmission])

  // A newer generation's successful save (acknowledged by the server)
  // supersedes any older generation this component is still retrying/queuing
  // for the same question+run — both in this component's own retained-draft
  // map and in useResonanceSession's separate reconnect-replay queue, which
  // has no other way to learn a newer attempt already landed.
  const handleDraftSaved = useCallback((payload: Record<string, unknown>) => {
    const key = buildUnconfirmedDraftKey(payload)
    if (key === null) return
    const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
    const generation = resolveDraftGeneration(payload)
    clearRetainedDraftIfSuperseded(questionId, asRunIdentitySource(payload), generation)
    cancelDraftRetries(key, generation)
  }, [cancelDraftRetries, clearRetainedDraftIfSuperseded])

  useEffect(() => {
    const hasAnyUnconfirmedDraft = [...questionDraftStateRef.current.values()].some(
      (state) => state.unconfirmedDraft !== null,
    )
    if (!hasAnyUnconfirmedDraft || snapshot === null || studentId === null) {
      return
    }

    const retryUnconfirmedDrafts = () => {
      const now = Date.now()
      let changed = false

      for (const [questionId, state] of questionDraftStateRef.current) {
        let draft = state.unconfirmedDraft
        if (draft === null) continue

        const canonicalPayload = canonicalizeLegacyRevisionOneDraft(draft.payload, snapshot)
        if (canonicalPayload !== draft.payload) {
          const legacyKey = buildDraftRetryKey(draft.payload)
          const canonicalKey = buildDraftRetryKey(canonicalPayload)
          if (canonicalKey !== null && canonicalKey !== legacyKey) {
            // An in-flight reconnect-replay send for the legacy key
            // (already sent, not just queued) can still be acknowledged
            // after this migration moves the retained entry to its
            // canonical run token. That late ack still resolves correctly
            // without any alias bookkeeping here: useResonanceSession
            // carries the run identity the ack itself names, and
            // acknowledgeQuestionDraftGeneration (see clearRetainedDraftIfSuperseded)
            // recognizes it as the same run via payloadMatchesResolvedRunToken,
            // not a raw key match.
            const canonicalRunToken = resolvePayloadRunToken(canonicalPayload)
            if (canonicalRunToken !== null && state.runToken !== canonicalRunToken) {
              // Canonicalizing the run token preserves attemptedGeneration,
              // acknowledgedGeneration, and the retained draft itself in
              // place — they're all on this same record now, so nothing
              // needs to be copied across a separate key namespace the way
              // it once did.
              canonicalizeQuestionRunToken(questionDraftStateRef.current, questionId, canonicalRunToken)
            }
            if (legacyKey !== null) {
              cancelDraftRetries(legacyKey, state.attemptedGeneration)
              cancelDraftRetries(canonicalKey, state.acknowledgedGeneration)
            }
            draft = { ...draft, payload: canonicalPayload }
            state.unconfirmedDraft = draft
            changed = true
          }
        }

        const disposition = resolveUnconfirmedDraftDisposition(draft.payload, snapshot, studentId, now)

        if (disposition === 'discard') {
          state.unconfirmedDraft = null
          changed = true
          const payloadRunRevision = typeof draft.payload.activeQuestionRunRevision === 'number'
            ? draft.payload.activeQuestionRunRevision
            : typeof draft.payload.activeQuestionRunStartedAt === 'number'
              ? 1
              : null
          const expiredRunJustEnded = draft.deadlineAt !== null && now >= draft.deadlineAt &&
            snapshot.activeQuestionRunRevision === null &&
            snapshot.lastActiveQuestionRunRevision === payloadRunRevision
          if (expiredRunJustEnded) {
            reconcileUnconfirmedDraft(questionId, draft.payload)
          } else {
            discardUnconfirmedDraft(questionId, draft.payload)
          }
          continue
        }

        if (disposition === 'reconcile') {
          state.unconfirmedDraft = null
          changed = true
          reconcileUnconfirmedDraft(questionId, draft.payload)
          continue
        }

        if (draft.retrying) continue
        draft.retrying = true
        const draftBeingSaved = draft
        void saveDraft(draftBeingSaved.payload).then((saved) => {
          if (questionDraftStateRef.current.get(questionId)?.unconfirmedDraft !== draftBeingSaved) return
          if (saved) {
            const currentState = questionDraftStateRef.current.get(questionId)
            if (currentState) currentState.unconfirmedDraft = null
            // Bump unconditionally, even if the effect that started this
            // retry has since been superseded by a snapshot update: this is
            // the only way the *replacement* effect (which is in the
            // dependency array on this same version counter) learns nothing
            // is outstanding anymore and stops polling on its own interval
            // forever.
            setUnconfirmedDraftVersion((current) => current + 1)
            return
          }
          draftBeingSaved.retrying = false
        })
      }

      if (changed) {
        setUnconfirmedDraftVersion((current) => current + 1)
      }
    }

    retryUnconfirmedDrafts()
    const intervalId = window.setInterval(retryUnconfirmedDrafts, UNCONFIRMED_DRAFT_RETRY_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [discardUnconfirmedDraft, reconcileUnconfirmedDraft, saveDraft, snapshot, studentId, unconfirmedDraftVersion])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (snapshot === null) {
      return
    }

    setSubmittedAnswers((current) => {
      if (!snapshot.selfPacedMode) {
        return { ...snapshot.submittedAnswers, ...current }
      }
      // A live run can hand off directly to a self-paced snapshot without an
      // intermediate idle snapshot in between (e.g. its SyncDeck parent
      // going standalone mid-run) — the didRunRestart cleanup further below
      // never runs for that transition, since it's gated on this branch not
      // being taken. Self-paced mode has no run identity of its own, so any
      // local entry still stamped with an actual (non-null) run token
      // belongs to the run that just ended, not to this self-paced context,
      // and must not keep rendering — or be resubmittable — as if it did.
      let changed = false
      const next: typeof current = {}
      for (const [questionId, answer] of Object.entries(current)) {
        if (getQuestionRunToken(questionDraftStateRef.current, questionId) === null) {
          next[questionId] = answer
        } else {
          changed = true
        }
      }
      return { ...snapshot.submittedAnswers, ...(changed ? next : current) }
    })

    if (snapshot.selfPacedMode) {
      setSubmittedQuestionIds((current) => {
        const next = new Set(current)
        for (const questionId of Object.keys(snapshot.submittedAnswers)) {
          next.add(questionId)
        }
        return next
      })
      const availableIds = snapshot.activeQuestions.map((question) => question.id)
      previousActiveQuestionIdsRef.current = availableIds
      previousActiveQuestionRunRevisionRef.current = snapshot.activeQuestionRunRevision
      previousActiveQuestionRunStartedAtRef.current = snapshot.activeQuestionRunStartedAt
      hasObservedSnapshotRef.current = true

      if (availableIds.length === 0) {
        setSelectedQuestionId(null)
        return
      }

      setSelectedQuestionId((current) => (current && availableIds.includes(current) ? current : availableIds[0] ?? null))
      return
    }

    const hasObservedSnapshot = hasObservedSnapshotRef.current
    const activeRunStartedAt = snapshot.activeQuestionRunStartedAt
    const activeIds = snapshot.activeQuestions.map((question) => question.id)
    const previousActiveIds = previousActiveQuestionIdsRef.current

    const runToken = snapshot.activeQuestionRunRevision ?? activeRunStartedAt
    for (const questionId of activeIds) {
      const confirmedEditSequence = snapshot.submittedResponseEditSequences[questionId]
      if (confirmedEditSequence !== undefined) {
        seedQuestionEditSequenceFromConfirmedResponse(questionDraftStateRef.current, questionId, runToken, confirmedEditSequence)
      }
    }

    const reactivatedIds = hasObservedSnapshot
      ? activeIds.filter((questionId) => !previousActiveIds.includes(questionId))
      : []
    const didRunRestart = hasActiveQuestionRunRestart({
      hasObservedSnapshot,
      activeQuestionIds: activeIds,
      activeQuestionRunRevision: snapshot.activeQuestionRunRevision,
      previousActiveQuestionRunRevision: previousActiveQuestionRunRevisionRef.current,
      activeQuestionRunStartedAt: activeRunStartedAt,
      previousActiveQuestionRunStartedAt: previousActiveQuestionRunStartedAtRef.current,
    })

    if (reactivatedIds.length > 0 || didRunRestart) {
      setSubmittedQuestionIds((current) => {
        const next = new Set(current)
        for (const questionId of didRunRestart ? activeIds : reactivatedIds) {
          next.delete(questionId)
        }
        return next
      })
    }

    if (didRunRestart) {
      // resolveQuestionAnswer always prefers a submittedAnswers entry over
      // the server snapshot. Without this, a run-7 answer (confirmed or a
      // still-undischarged failed draft) stays displayed — and resubmittable
      // — under the new run-8 token until the stale-run retry/discard cycle
      // eventually clears it. Drop entries whose recorded run doesn't match
      // the new run immediately, so QuestionView can't resurface or resend
      // them in the meantime.
      //
      // Capture each question's *current* recorded runToken synchronously,
      // right here — not inside the setSubmittedAnswers updater below. A
      // functional setState updater's body doesn't run when it's passed to
      // setState; React defers it to the next render's state computation,
      // by which point every effect from this commit (including the
      // generation-seeding effect declared below, which stamps a question's
      // record to this same new run as a side effect of seeding its
      // generation floor) has already run — so a live ref read inside the
      // updater would always see the *post*-seeding value, defeating this
      // check for exactly the questions it exists to catch. The seeding
      // effect must also stay declared after this one: effects run in
      // declaration order within a commit, and this capture only sees the
      // pre-seeding value if it runs first.
      const priorRunTokenByQuestionId = new Map(
        activeIds.map((questionId) => [questionId, getQuestionRunToken(questionDraftStateRef.current, questionId)]),
      )
      setSubmittedAnswers((current) => {
        let changed = false
        const next = { ...current }
        for (const questionId of activeIds) {
          if (
            Object.prototype.hasOwnProperty.call(next, questionId) &&
            priorRunTokenByQuestionId.get(questionId) !== runToken
          ) {
            delete next[questionId]
            changed = true
          }
        }
        return changed ? next : current
      })
    }
    hasObservedSnapshotRef.current = true
    previousActiveQuestionIdsRef.current = activeIds
    previousActiveQuestionRunRevisionRef.current = snapshot.activeQuestionRunRevision
    previousActiveQuestionRunStartedAtRef.current = activeRunStartedAt

    if (activeIds.length === 0) {
      setSelectedQuestionId(null)
      return
    }

    setSelectedQuestionId((current) => (current && activeIds.includes(current) ? current : activeIds[0] ?? null))
  }, [snapshot])

  useEffect(() => {
    if (snapshot === null) return
    const runToken = snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt
    for (const [questionId, generation] of Object.entries(snapshot.draftGenerations)) {
      seedQuestionAttemptedGeneration(questionDraftStateRef.current, questionId, runToken, generation)
    }
  }, [snapshot])

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <p className="text-slate-500 dark:text-slate-400">No active session.</p>
      </div>
    )
  }

  if (!identityResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <p className="text-slate-400 dark:text-slate-500 text-sm">Loading…</p>
      </div>
    )
  }

  if (!nameSubmitted) {
    return (
      <NameEntryForm
        sessionId={sessionId}
        onRegistered={(id, name) => {
          persistSessionParticipantIdentity(window.localStorage, sessionId, name, id)
          setStudentId(id)
          setStudentName(name)
          setNameSubmitted(true)
          setRegistered(true)
        }}
      />
    )
  }

  if (!registered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        {registerError !== null ? (
          <p className="text-red-600 dark:text-red-400 text-sm" role="alert">{registerError}</p>
        ) : (
          <p className="text-slate-400 dark:text-slate-500 text-sm">Joining session…</p>
        )}
      </div>
    )
  }

  // ── Main session view ────────────────────────────────────────────────────────

  const activeQuestions = snapshot?.activeQuestions ?? []
  const activeQuestion = activeQuestions.find((question) => question.id === selectedQuestionId) ?? activeQuestions[0] ?? null
  const activeDeadlineAt = snapshot?.activeQuestionDeadlineAt ?? null
  const hasExpired = activeDeadlineAt !== null && activeDeadlineAt <= countdownNow
  const liveCountdown = formatRemainingTime(activeDeadlineAt, countdownNow)
  const questionStatusBadge = snapshot !== null ? resolveQuestionStatusBadge(snapshot.selfPacedMode) : null
  const submittedMessage = snapshot?.selfPacedMode && activeQuestion
    ? resolveSelfPacedSubmittedMessage({
      questionIds: activeQuestions.map((question) => question.id),
      submittedQuestionIds,
      currentQuestionId: activeQuestion.id,
    })
    : 'Answer submitted.'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {submissionAnnouncement !== null && (
        <p key={submissionAnnouncement.id} className="sr-only" role="status" aria-live="polite">
          {submissionAnnouncement.message}
        </p>
      )}

      {/* Countdown header strip — only shown when a timed question is live */}
      {liveCountdown !== null && activeQuestions.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-5 py-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
            Time remaining
          </span>
          <span className="text-lg font-bold tabular-nums text-amber-900 dark:text-amber-300">
            {liveCountdown}
          </span>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">

        {/* Session loading / error */}
        {sessionLoading && snapshot === null && (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading session…</p>
        )}
        {sessionError !== null && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {sessionError}
          </p>
        )}

        {/* Active question(s) */}
        {snapshot !== null && activeQuestion !== null && studentId !== null && (
          <section aria-label="Current question" className="space-y-5">
            {/* Live badge */}
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 rounded-full px-3 py-1.5">
                <span className={questionStatusBadge?.dotClassName} />
                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                  {questionStatusBadge?.label}
                </span>
              </span>

              {/* Multi-question nav tabs */}
              {activeQuestions.length > 1 && (
                <nav className="flex flex-wrap gap-2" aria-label="Active questions">
                  {activeQuestions.map((question, index) => {
                    const isSelected = question.id === activeQuestion.id
                    const isSubmitted = submittedQuestionIds.has(question.id)
                    return (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => {
                          const runToken = snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt
                          const isRevisit = !snapshot.selfPacedMode && submittedQuestionIds.has(question.id)
                          setSubmittedQuestionIds((current) => clearLiveQuestionSubmission({
                            selfPacedMode: snapshot.selfPacedMode,
                            submittedQuestionIds: current,
                            questionId: question.id,
                          }))
                          if (isRevisit) {
                            advanceQuestionEditSequenceForRevisit(questionDraftStateRef.current, question.id, runToken)
                          }
                          setSelectedQuestionId(question.id)
                        }}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                        aria-pressed={isSelected}
                      >
                        Q{index + 1}{isSubmitted ? ' ✓' : ''}
                      </button>
                    )
                  })}
                </nav>
              )}
            </div>

            {/* Question card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm px-6 py-6">
              <QuestionView
                key={activeQuestion.id}
                question={activeQuestion}
                sessionId={sessionId}
                studentId={studentId}
                initialAnswer={resolveQuestionAnswer({
                  localAnswers: submittedAnswers,
                  snapshotAnswers: snapshot.submittedAnswers,
                  questionId: activeQuestion.id,
                })}
                activeQuestionRunStartedAt={snapshot.activeQuestionRunStartedAt}
                activeQuestionRunRevision={snapshot.activeQuestionRunRevision}
                activeQuestionDeadlineAt={snapshot.activeQuestionDeadlineAt}
                editSequence={resolveQuestionEditSequence(
                  questionDraftStateRef.current,
                  activeQuestion.id,
                  snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt,
                )}
                nextDraftGeneration={nextDraftGeneration}
                draftResetVersion={draftResetVersions[activeQuestion.id] ?? 0}
                disabled={hasExpired}
                isSubmitted={submittedQuestionIds.has(activeQuestion.id)}
                submittedMessage={submittedMessage}
                announceSubmittedMessage={!snapshot.selfPacedMode}
                saveDraft={saveDraft}
                onDraftChanged={(questionId, answer) => {
                  const runToken = snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt
                  setQuestionRunToken(questionDraftStateRef.current, questionId, runToken)
                  // A failed autosave can already be retained while the
                  // student continues typing. Keep its reconciliation value
                  // current: if the deadline cuts off the child's debounce,
                  // the parent must reconcile the newest optimistic answer,
                  // not discard the older retained payload on mismatch.
                  const retained = getQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken)
                  if (retained !== null) {
                    const supersededGeneration = resolveDraftGeneration(retained.payload)
                    const replacementGeneration = nextDraftGeneration(questionId, runToken)
                    // useResonanceSession owns reconnect retries separately.
                    // Stop its old-generation replay before retaining the
                    // replacement, otherwise that replay's acknowledgement
                    // can incorrectly clear this newer local answer.
                    const retryKey = buildDraftRetryKey(retained.payload)
                    if (retryKey !== null) cancelDraftRetries(retryKey, supersededGeneration)
                    // Replace, rather than mutate, the retained entry. An
                    // older retry may already be in flight; its completion
                    // is identity-checked by the retry loop and must not be
                    // allowed to delete this newer draft.
                    setQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken, {
                      ...retained,
                      payload: {
                        ...retained.payload,
                        editSequence: resolveQuestionEditSequence(questionDraftStateRef.current, questionId, runToken),
                        draftGeneration: replacementGeneration,
                        answer,
                      },
                      retrying: false,
                    })
                    setUnconfirmedDraftVersion((current) => current + 1)
                  }
                  setSubmittedAnswers((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                }}
                onDraftSaveFailed={recordUnconfirmedDraft}
                onDraftSaved={handleDraftSaved}
                onSubmitted={(questionId, answer, submissionRunIdentity) => {
                  // This can fire after the QuestionView instance that sent
                  // it has unmounted (a stack-tab switch) and even, since it
                  // was unmounted, been remounted again — so its own checks
                  // (frozen refs from its last render) aren't trustworthy.
                  // Re-validate against the parent's actual current state
                  // (read from the ref, not the `snapshot` this closure was
                  // created with — an older render's closure can still be
                  // the one that runs) before touching anything:
                  //   - a run restart since this submission was sent means
                  //     it belongs to a run that's already over — the
                  //     didRunRestart cleanup elsewhere already handled that
                  //     transition, and applying a stale-run answer here
                  //     would undo it.
                  //   - a locally-cached answer for this question that
                  //     differs from what this submission is about to apply
                  //     means a replacement view (after this one unmounted
                  //     and remounted, e.g. a stack-tab switch away and back)
                  //     has made its own newer, independent edit since —
                  //     applying this older answer would clobber it. A
                  //     draft-generation comparison was tried first but
                  //     false-positived on this view's own harmless
                  //     flush-on-unmount re-send of the *same* answer it had
                  //     just submitted; comparing the answer content itself
                  //     doesn't have that problem.
                  // A stale submission is fully discarded rather than
                  // partially applied: the server did persist it, so the
                  // next snapshot naturally reconciles it into local state
                  // through the ordinary submittedAnswers merge.
                  const currentSnapshot = snapshotRef.current
                  if (currentSnapshot === null) return
                  const currentRunIdentity: RunIdentitySource = {
                    activeQuestionRunRevision: currentSnapshot.activeQuestionRunRevision,
                    activeQuestionRunStartedAt: currentSnapshot.activeQuestionRunStartedAt,
                  }
                  // runIdentitiesMatch (not a raw !==): a submission sent
                  // while this run was still in legacy timestamp-only form
                  // must still be recognized once a later snapshot
                  // canonicalizes that same run to revision 1 — otherwise the
                  // server persists the answer but the parent never learns,
                  // leaving its submitted/retained-draft bookkeeping stuck on
                  // the pre-submission state.
                  if (!runIdentitiesMatch(currentRunIdentity, submissionRunIdentity)) return
                  if (
                    Object.prototype.hasOwnProperty.call(submittedAnswersRef.current, questionId) &&
                    !isSameDraftAnswer(answer, submittedAnswersRef.current[questionId])
                  ) return

                  // Use the run's current canonical token, not the
                  // submission's own (possibly still-legacy) one: every
                  // QuestionDraftState field below is read back keyed by
                  // `snapshot.activeQuestionRunRevision ?? ...StartedAt` on
                  // the next render, so writing under a different-but-
                  // equivalent token would make that read see a mismatch and
                  // reset the record, losing the watermarks this call is
                  // trying to record.
                  const runToken = resolveRunToken(currentRunIdentity)
                  setQuestionRunToken(questionDraftStateRef.current, questionId, runToken)
                  recordQuestionSubmittedEditSequence(
                    questionDraftStateRef.current,
                    questionId,
                    runToken,
                    resolveQuestionEditSequence(questionDraftStateRef.current, questionId, runToken),
                  )
                  setSubmittedAnswers((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                  // A retained failed-autosave for this question (e.g. the
                  // WebSocket was down when this submission went through over
                  // REST) is now redundant. Self-paced questions have no
                  // deadline and never leave activeQuestionIds, so without
                  // this the 1-second retry loop would otherwise keep
                  // resending it until the next snapshot happens to carry a
                  // matching submittedResponseEditSequences entry. Also
                  // cancel any reconnect-queued draft-retry for this
                  // question+run in the hook itself — that queue is separate
                  // from this component's own retained-draft state and has
                  // no other way to learn a submission already settled it.
                  const retainedDraft = getQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken)
                  const retainedDraftKey = buildDraftRetryKey({
                    questionId,
                    activeQuestionRunRevision: currentSnapshot.activeQuestionRunRevision,
                    activeQuestionRunStartedAt: currentSnapshot.activeQuestionRunStartedAt,
                  })
                  if (retainedDraft) {
                    const retainedEditSequence =
                      typeof retainedDraft.payload.editSequence === 'number' ? retainedDraft.payload.editSequence : 0
                    const submittedEditSequence = resolveQuestionEditSequence(questionDraftStateRef.current, questionId, runToken)
                    if (retainedEditSequence <= submittedEditSequence) {
                      setQuestionUnconfirmedDraft(questionDraftStateRef.current, questionId, runToken, null)
                      setUnconfirmedDraftVersion((current) => current + 1)
                    }
                  }
                  // Cap the cancellation at the highest generation actually
                  // allocated so far for this question+run, not an unbounded
                  // sentinel: live Resonance allows revisiting a submitted
                  // question in the same run, and a permanent ceiling would
                  // make queueDraftRetry reject every later revisit edit's
                  // failed autosave from ever being replayed on reconnect.
                  cancelDraftRetries(
                    retainedDraftKey,
                    getQuestionAttemptedGeneration(questionDraftStateRef.current, questionId, runToken),
                  )
                  setSubmittedQuestionIds((current) => {
                    const nextSubmittedQuestionIds = new Set(current)
                    nextSubmittedQuestionIds.add(questionId)
                    const currentActiveQuestions = currentSnapshot.activeQuestions
                    const nextAnnouncement = resolveSubmissionAnnouncement({
                      selfPacedMode: currentSnapshot.selfPacedMode,
                      questionIds: currentActiveQuestions.map((question) => question.id),
                      submittedQuestionIds: nextSubmittedQuestionIds,
                      currentQuestionId: questionId,
                    })
                    if (nextAnnouncement) {
                      setSubmissionAnnouncement((currentAnnouncement) => ({
                        id: (currentAnnouncement?.id ?? 0) + 1,
                        message: nextAnnouncement,
                      }))
                    }
                    if (currentSnapshot.selfPacedMode) {
                      setSelectedQuestionId((currentQuestionId) => resolveNextSelfPacedQuestionId({
                        questionIds: currentActiveQuestions.map((question) => question.id),
                        submittedQuestionIds: nextSubmittedQuestionIds,
                        currentQuestionId: currentQuestionId ?? questionId,
                      }))
                    }
                    return nextSubmittedQuestionIds
                  })
                }}
                sendMessage={sendMessage}
              />
            </div>
          </section>
        )}

        {/* Waiting state */}
        {snapshot !== null && activeQuestions.length === 0 && snapshot.reveals.length === 0 && snapshot.reviewedResponses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mb-5">
              <svg
                className="w-8 h-8 text-indigo-500 dark:text-indigo-400"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <p className="text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              Waiting for a question
            </p>
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Your instructor will activate a question shortly…
            </p>
          </div>
        )}

        {/* Shared responses / reveals / private feedback */}
        {snapshot !== null && (snapshot.reveals.length > 0 || snapshot.reviewedResponses.length > 0) && (
          <SharedResponseFeed
            reveals={snapshot.reveals}
            reviewedResponses={snapshot.reviewedResponses}
            revealedQuestions={snapshot.revealedQuestions}
            onReactToSharedResponse={(questionId, sharedResponseId, emoji) => {
              sendMessage('resonance:react-to-shared', {
                questionId,
                sharedResponseId,
                emoji,
              })
            }}
          />
        )}
      </div>
    </div>
  )
}
