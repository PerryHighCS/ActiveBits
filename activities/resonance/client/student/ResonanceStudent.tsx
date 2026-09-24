import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useResonanceSession } from '../hooks/useResonanceSession.js'
import NameEntryForm from './NameEntryForm.js'
import QuestionView, { isSameAnswer } from './QuestionView.js'
import SharedResponseFeed from './SharedResponseFeed.js'
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

/**
 * Per-question/run edit-sequence bookkeeping, keyed independently of any one
 * QuestionView mount so it survives that component remounting when the
 * student switches stack tabs away and back. `runToken` should be the same
 * activeQuestionRunRevision value passed to QuestionView, so a new run
 * naturally starts its own counter at the baseline.
 */
export function buildEditSequenceKey(questionId: string, runToken: number | null): string {
  return `${questionId}:${runToken ?? 'null'}`
}

export function resolveCurrentEditSequence(
  editSequenceByKey: Record<string, number>,
  questionId: string,
  runToken: number | null,
): number {
  return editSequenceByKey[buildEditSequenceKey(questionId, runToken)] ?? 1
}

export function advanceEditSequenceForRevisit(
  editSequenceByKey: Record<string, number>,
  questionId: string,
  runToken: number | null,
): Record<string, number> {
  const key = buildEditSequenceKey(questionId, runToken)
  return { ...editSequenceByKey, [key]: (editSequenceByKey[key] ?? 1) + 1 }
}

/**
 * This in-memory counter has no local history to build on right after a page
 * reload, so it would otherwise default a post-reload revision to sequence 1
 * — colliding with (or trailing) a confirmed response the server already has
 * at sequence 1+, and having the revision silently dropped as stale by the
 * server's draft guard. Seed the counter from the server-confirmed response's
 * own editSequence (floor = confirmed + 1) whenever it would otherwise leave
 * a lower value in place; never lowers an already-advanced local counter.
 *
 * `confirmed + 1` alone is only correct when at most one revisit has ever
 * happened since that confirmation. A revisit's bump
 * (`advanceEditSequenceForRevisit`) reads whatever the local counter
 * *already* holds, not the confirmed value directly — and a snapshot
 * reflecting the just-confirmed response typically arrives (and this same
 * seed already runs once) before a human has a chance to click revisit, so
 * a real revisit usually lands on `confirmed + 2`, not `confirmed + 1`. A
 * reload after that revisit's own edit would otherwise re-seed too low and
 * have every subsequent edit rejected as stale forever (the server's
 * ordering guard never lets a lower editSequence back in). `draftEditSequence`
 * — the stored draft's own editSequence from the snapshot, when there is an
 * unconfirmed draft — reconstructs the true floor directly instead of
 * re-deriving it from the confirmed value's assumed history.
 */
export function seedEditSequenceFromConfirmedResponse(
  editSequenceByKey: Record<string, number>,
  questionId: string,
  runToken: number | null,
  confirmedEditSequence: number,
  draftEditSequence = 0,
): Record<string, number> {
  const key = buildEditSequenceKey(questionId, runToken)
  const floor = Math.max(confirmedEditSequence + 1, draftEditSequence)
  if ((editSequenceByKey[key] ?? 1) >= floor) {
    return editSequenceByKey
  }
  return { ...editSequenceByKey, [key]: floor }
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

/**
 * Drops a set of questions' locally-cached answers instead of letting them
 * keep winning the local-cache-over-snapshot precedence in the snapshot
 * merge effect. Used both when a question's run restarts/reactivates
 * (without this, a stale prior-run value would both wrongly prefill the
 * reopened QuestionView and get resent to the server as a "current" draft
 * under the new run's revision) and when a draft is still unconfirmed past
 * its deadline (the client should stop trusting its own optimistic value and
 * let a subsequent snapshot's — possibly older — server-finalized answer win).
 */
export function resetAnswersForRestartedQuestions(params: {
  submittedAnswers: Record<string, AnswerPayload | null>
  questionIdsToReset: string[]
}): Record<string, AnswerPayload | null> {
  if (params.questionIdsToReset.length === 0) {
    return params.submittedAnswers
  }
  const next = { ...params.submittedAnswers }
  for (const questionId of params.questionIdsToReset) {
    delete next[questionId]
  }
  return next
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
}): boolean {
  return (
    params.hasObservedSnapshot &&
    params.activeQuestionIds.length > 0 &&
    params.activeQuestionRunRevision !== params.previousActiveQuestionRunRevision
  )
}

// How often the parent-owned draft retry loop resends any question's current
// answer while it remains unconfirmed by the server. This is not a
// correctness mechanism (the loop always sends the *current* value, so a
// retry can never race an edit into producing a wrong result) — it's purely
// to avoid a network message on every keystroke.
export const DRAFT_RETRY_INTERVAL_MS = 1_000

// A short quiet-period debounce after an edit, separate from the retry
// interval above: without it, an edit made shortly before a deadline could
// wait up to DRAFT_RETRY_INTERVAL_MS for the next tick, which might not
// arrive before the deadline passes. This fires an attempt soon after the
// student stops typing regardless of where in the interval's cycle that is.
export const DRAFT_EDIT_DEBOUNCE_MS = 400

// The update-draft handler rejects (silently, no ack) any write whose
// server-side arrival time is at or past the run's deadline — see its own
// `draftUpdatedAt >= activeQuestionDeadlineAt` check in routes.ts. A fixed
// DRAFT_EDIT_DEBOUNCE_MS delay ignores how little time is actually left: an
// edit made in the final DRAFT_EDIT_DEBOUNCE_MS before a deadline would
// debounce to *after* it, guaranteeing the server rejects it — losing the
// student's last edit even though it was "sent." scheduleDraftSend shortens
// its delay as the deadline approaches (down to an immediate send) so the
// attempt has a real chance of arriving before the server's own clock does,
// leaving this much margin for network/processing latency.
const DRAFT_DEADLINE_BUFFER_MS = 100

/**
 * Which currently-active questions have a locally-known answer the server
 * hasn't confirmed yet and should be (re)sent this tick. Owned by the parent
 * (not QuestionView) because QuestionView is remounted on every stack-tab
 * switch and would lose track of an outstanding save; see issue #374.
 */
export function selectUnconfirmedDraftQuestionIds(params: {
  activeQuestionIds: string[]
  submittedQuestionIds: ReadonlySet<string>
  unconfirmedQuestionIds: ReadonlySet<string>
}): string[] {
  return params.activeQuestionIds.filter(
    (questionId) =>
      params.unconfirmedQuestionIds.has(questionId) && !params.submittedQuestionIds.has(questionId),
  )
}

/**
 * The single place that abandons a question's draft-send tracking. Every
 * site that stops caring about a question's outstanding draft attempt for a
 * reason *other than that attempt's own acknowledgement* (the question was
 * submitted, its run restarted or reactivated, or its deadline was
 * reconciled) must clear both `unconfirmedQuestionIds` and
 * `inFlightDraftQuestionIds` together. Leaving a stale in-flight marker set
 * blocks `attemptDraftSend`'s guard from sending a fresh attempt for that
 * question until the old one times out (up to `DRAFT_SAVE_ACK_TIMEOUT_MS`),
 * which can delay or drop an edit made right at a deadline. A stale ack for
 * the abandoned attempt is still handled safely on arrival — it no-ops
 * against `attemptDraftSend`'s own revision/edit-sequence check — so
 * clearing the in-flight marker here is always safe even if that attempt is
 * still outstanding.
 */
export function clearDraftTracking(params: {
  unconfirmedQuestionIds: Set<string>
  inFlightDraftQuestionIds: Map<string, number>
  unconfirmedQuestionRunRevisions: Map<string, number | null>
  questionIds: readonly string[]
}): void {
  for (const questionId of params.questionIds) {
    params.unconfirmedQuestionIds.delete(questionId)
    params.inFlightDraftQuestionIds.delete(questionId)
    params.unconfirmedQuestionRunRevisions.delete(questionId)
  }
}

/**
 * Whether a question's unconfirmed local answer still belongs to the run
 * revision currently in effect — the guard attemptDraftSend uses to decide
 * whether it's actually safe to send.
 *
 * A run transition's own cleanup (clearDraftTracking, from the snapshot-merge
 * effect) runs in a passive effect, which React schedules *after* the render
 * that already updated the current snapshot — an already-due debounce/retry
 * timer can fire in that window, before cleanup has removed the question from
 * unconfirmedQuestionIds. Checking set-membership alone (as the other guard
 * conditions in attemptDraftSend do) can't see that window: the question is
 * still nominally "unconfirmed" even though the context it was dirtied under
 * has already moved on. Comparing against the revision actually recorded at
 * the moment the question became dirty (onDraftChanged) closes that window
 * directly, independent of whether cleanup has run yet — a mismatch means the
 * local answer belongs to a run/self-paced context that's already gone, and
 * sending it now would stamp it with a revision it was never actually written
 * under, letting a stale answer be silently accepted as legitimate content for
 * a context it was never part of.
 */
export function isDraftStillCurrentForRevision(params: {
  unconfirmedQuestionRunRevisions: ReadonlyMap<string, number | null>
  questionId: string
  currentRunRevision: number | null
}): boolean {
  return params.unconfirmedQuestionRunRevisions.get(params.questionId) === params.currentRunRevision
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
  // Bumped per-question whenever the deadline-reconciliation branch below
  // successfully replaces that question's optimistic local answer with the
  // server-finalized one. QuestionView deliberately ignores a changed
  // initialAnswer prop while its own local draftAnswer still differs from
  // what it last synchronized (see isSameAnswer's usage in QuestionView.tsx)
  // — by design, so an ordinary parent re-render never yanks away in-progress
  // typing. That guard also means resetting submittedAnswers here alone is
  // not enough once reconciliation actually succeeds: a staged/standard run
  // stays mounted (just disabled) past its deadline, so the same QuestionView
  // instance would otherwise keep showing the discarded optimistic answer
  // instead of whatever the server actually finalized. Folding this into the
  // QuestionView key forces a real remount at exactly that moment, resetting
  // its internal state so the fresh initialAnswer prop is adopted immediately.
  const [answerReconciliationGeneration, setAnswerReconciliationGeneration] = useState<Record<string, number>>({})
  const [submissionAnnouncement, setSubmissionAnnouncement] = useState<SubmissionAnnouncement | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())

  const previousActiveQuestionIdsRef = useRef<string[]>([])
  const previousActiveQuestionRunRevisionRef = useRef<number | null>(null)
  const hasObservedSnapshotRef = useRef(false)
  // Owned here (not in QuestionView) because QuestionView remounts on every
  // stack-tab switch (it's keyed by question id): a counter local to it would
  // reset to its baseline on remount, colliding with the sequence already
  // recorded on a confirmed response and causing a legitimate revisit edit to
  // be dropped as stale. See resolveCurrentEditSequence/advanceEditSequenceForRevisit.
  const editSequenceByKeyRef = useRef<Record<string, number>>({})
  // Question ids whose current submittedAnswers[] value hasn't been confirmed
  // saved by the server yet. Owned here (not QuestionView) for the same
  // remount-survival reason as editSequenceByKeyRef — see the draft-retry
  // effect below and issue #374.
  const unconfirmedQuestionIdsRef = useRef<Set<string>>(new Set())
  // The run revision in effect at the moment each question in
  // unconfirmedQuestionIdsRef became dirty (onDraftChanged). Run-transition
  // cleanup (clearDraftTracking, called from the snapshot-merge effect and
  // the deadline-reconciliation branch below) runs in a passive effect,
  // which is scheduled *after* the render that already updated snapshotRef
  // to the new revision — an already-due debounce/interval timer can fire
  // in that window, before cleanup has removed the question from
  // unconfirmedQuestionIdsRef. Without recording the revision a question
  // was actually dirtied under, attemptDraftSend would stamp that stale
  // send with whichever revision is current *now*, not the one the local
  // answer actually belongs to — letting a stale answer be accepted as
  // legitimate content for a new run/self-paced context it was never part
  // of. See attemptDraftSend's own revision check below.
  const unconfirmedQuestionRunRevisionsRef = useRef<Map<string, number | null>>(new Map())
  // Maps a question id to a token identifying whichever attemptDraftSend call
  // is currently outstanding for it. A plain presence flag isn't enough: if
  // attempt A is abandoned (clearDraftTracking) while still outstanding and a
  // fresh attempt B then starts before A's saveDraft() promise settles, A's
  // eventual settlement must not clear B's in-flight marker — only a
  // settlement that still owns the current token may clear the entry.
  const inFlightDraftQuestionIdsRef = useRef<Map<string, number>>(new Map())
  const nextDraftAttemptTokenRef = useRef(0)
  // Monotonically increasing across every send attempt for every question
  // (not per-question — a single shared counter is simpler and still totally
  // orders any two sends for the same question, which is all the server-side
  // guard that reads this ever compares). Sent as draftSendSequence so the
  // server can order two same-editSequence writes for the same question by
  // actual client send order — see the ordering guard in the
  // resonance:update-draft handler for why its own resumption timestamp
  // can't be used for this instead.
  const nextDraftSendSequenceRef = useRef(0)
  // Per-question debounce timers that trigger an edit-triggered send attempt
  // shortly after the student stops typing (see DRAFT_EDIT_DEBOUNCE_MS).
  const draftSendTimeoutsRef = useRef<Map<string, number>>(new Map())
  // Tracks the {revision, deadlineAt} pair already reconciled via a
  // *successful* refresh(), so a still-unconfirmed draft past its deadline
  // triggers at most one refresh per run rather than one every retry-loop
  // tick.
  const reconciledExpiryRef = useRef<{ revision: number | null; deadlineAt: number | null } | null>(null)
  // The {revision, deadlineAt} pair currently awaiting refresh()'s result,
  // separate from reconciledExpiryRef (which only records success). Without
  // this split, a transient network failure would still have already
  // cleared draft tracking and marked the pair reconciled before the fetch
  // even settled — permanently skipping any further reconciliation attempt
  // for this run's deadline even though the server's finalized state was
  // never actually retrieved. Also doubles as an in-flight guard so a slow
  // refresh() doesn't get kicked off again on every retry tick while it's
  // still outstanding.
  const inFlightReconciliationRef = useRef<{ revision: number | null; deadlineAt: number | null } | null>(null)
  const submittedAnswersRef = useRef(submittedAnswers)
  submittedAnswersRef.current = submittedAnswers
  const submittedQuestionIdsRef = useRef(submittedQuestionIds)
  submittedQuestionIdsRef.current = submittedQuestionIds
  const studentIdRef = useRef(studentId)
  studentIdRef.current = studentId

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

  const { snapshot, loading: sessionLoading, error: sessionError, refresh, sendMessage, saveDraft } = useResonanceSession(
    registered && sessionId ? sessionId : null,
    studentId,
  )
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useLayoutEffect(() => {
    setSelectedQuestionId(null)
    setSubmittedQuestionIds(new Set())
    setSubmittedAnswers({})
    setAnswerReconciliationGeneration({})
    setSubmissionAnnouncement(null)
    previousActiveQuestionIdsRef.current = []
    previousActiveQuestionRunRevisionRef.current = null
    hasObservedSnapshotRef.current = false
    editSequenceByKeyRef.current = {}
    unconfirmedQuestionIdsRef.current = new Set()
    unconfirmedQuestionRunRevisionsRef.current = new Map()
    inFlightDraftQuestionIdsRef.current = new Map()
    for (const timeoutId of draftSendTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId)
    }
    draftSendTimeoutsRef.current.clear()
    reconciledExpiryRef.current = null
    inFlightReconciliationRef.current = null
  }, [sessionId, studentId])

  // Debounce timers are per-question and independent of the retry interval's
  // own effect lifecycle, so they need their own unmount cleanup.
  useEffect(() => {
    return () => {
      for (const timeoutId of draftSendTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId)
      }
      draftSendTimeoutsRef.current.clear()
    }
  }, [])

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

    // A live run ending — whether it falls back to self-paced mode, or ends
    // into a fully idle state with no active questions at all (the server
    // clears activeQuestionIds and reverts activeQuestionRunRevision to
    // null either way, see setActiveQuestions/clearActiveQuestions) — leaves
    // a still-unconfirmed question's local answer/tracking dangling unless
    // explicitly reset here. This is the mirror-image of the reactivation
    // reset below, which already resets the opposite direction (self-paced/
    // idle -> live). `activeQuestionRunRevision === null` is checked instead
    // of `snapshot.selfPacedMode` alone because both destinations need the
    // same treatment, for different reasons:
    // - Self-paced: a draft that never got confirmed under the live run's
    //   revision keeps its unconfirmed marker and gets resent by the retry
    //   loop under the new (self-paced, revision-null) identity. Because a
    //   draft's server-side storage slot is keyed only by
    //   questionId+studentId (not revision), and the update-draft ordering
    //   guard's same-editSequence tiebreaker (draftSendSequence) is a
    //   session-global counter blind to which revision an attempt "belongs"
    //   to, that stale retry can silently win over — and overwrite — a
    //   genuinely different, already-legitimate self-paced draft for the
    //   same question. See "an unconfirmed live-run draft does not
    //   overwrite an unrelated pre-existing self-paced draft".
    // - Fully idle (no active questions, not self-paced): the question is
    //   no longer in activeQuestionIds at all, so
    //   selectUnconfirmedDraftQuestionIds's activeQuestionIds filter drops
    //   it from every future retry tick regardless of tracking state — the
    //   retry-interval effect's own deadline-reconciliation branch (which
    //   would otherwise refresh() and clear this once the deadline passes)
    //   never even runs for it, since it's gated on the same
    //   still-unconfirmed selection. Left unhandled, the stale local answer
    //   and dangling unconfirmed marker would never be reconciled at all —
    //   worse than the self-paced case, which can at least still recover
    //   via a later retry tick. See "a live run ending into a fully idle
    //   state does not leave an unconfirmed draft stranded".
    // Resetting here, before the merge below, means the merge picks up the
    // snapshot's own (possibly different, possibly empty) submittedAnswers/
    // draftAnswers value for that question instead of the stale local cache.
    const wasLiveRun = hasObservedSnapshotRef.current && previousActiveQuestionRunRevisionRef.current !== null
    const idsLeavingLiveContext = wasLiveRun && snapshot.activeQuestionRunRevision === null
      ? previousActiveQuestionIdsRef.current
      : []
    if (idsLeavingLiveContext.length > 0) {
      clearDraftTracking({
        unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
        inFlightDraftQuestionIds: inFlightDraftQuestionIdsRef.current,
        unconfirmedQuestionRunRevisions: unconfirmedQuestionRunRevisionsRef.current,
        questionIds: idsLeavingLiveContext,
      })
    }

    // draftAnswers must win over submittedAnswers when both exist for the
    // same question: a post-submission revisit's draft is strictly newer
    // than the (now-stale) confirmed response it revised, and draftAnswers
    // exists specifically so a reload/remount can recover that in-progress
    // edit (see draftAnswers' own docstring) rather than showing what's
    // already been superseded. current (already-locally-known state) still
    // wins over both, since only the very first merge after mount can ever
    // have neither draftAnswers nor submittedAnswers already reflected there
    // — except for a question leaving a live context above, whose local
    // value is dropped first so the snapshot's own (possibly different)
    // value can win instead.
    setSubmittedAnswers((current) => ({
      ...snapshot.submittedAnswers,
      ...snapshot.draftAnswers,
      ...(idsLeavingLiveContext.length > 0
        ? resetAnswersForRestartedQuestions({ submittedAnswers: current, questionIdsToReset: idsLeavingLiveContext })
        : current),
    }))

    // A page reload restarts nextDraftSendSequenceRef at 0, but the server
    // may already hold a higher draftSendSequence for a restored draft (see
    // draftSendSequences' docstring). Ratchet up so the next send — even one
    // that isn't a revisit and so carries the same editSequence as what's
    // already stored — can't be rejected as stale for looking older than a
    // send from before this reload.
    const highestKnownDraftSendSequence = Math.max(0, ...Object.values(snapshot.draftSendSequences))
    if (highestKnownDraftSendSequence > nextDraftSendSequenceRef.current) {
      nextDraftSendSequenceRef.current = highestKnownDraftSendSequence
    }

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
      hasObservedSnapshotRef.current = true

      if (availableIds.length === 0) {
        setSelectedQuestionId(null)
        return
      }

      setSelectedQuestionId((current) => (current && availableIds.includes(current) ? current : availableIds[0] ?? null))
      return
    }

    const hasObservedSnapshot = hasObservedSnapshotRef.current
    const activeIds = snapshot.activeQuestions.map((question) => question.id)
    const previousActiveIds = previousActiveQuestionIdsRef.current

    for (const questionId of activeIds) {
      const confirmedEditSequence = snapshot.submittedResponseEditSequences[questionId]
      if (confirmedEditSequence !== undefined) {
        editSequenceByKeyRef.current = seedEditSequenceFromConfirmedResponse(
          editSequenceByKeyRef.current,
          questionId,
          snapshot.activeQuestionRunRevision,
          confirmedEditSequence,
          snapshot.draftEditSequences[questionId] ?? 0,
        )
      }
    }

    const reactivatedIds = hasObservedSnapshot
      ? activeIds.filter((questionId) => !previousActiveIds.includes(questionId))
      : []
    // A question dropping out of the active set entirely — a staged run
    // advancing to its next question, in particular — leaves this question's
    // unconfirmed marker and locally-cached answer behind with nothing to
    // reconcile them: once it's off activeIds, selectUnconfirmedDraftQuestionIds's
    // own filter (and the reactivatedIds/didRunRestart reset below, which
    // only resets the *incoming* ids) never touches it again. previousActiveQuestionIdsRef
    // is overwritten on every merge (below), so if this id isn't captured
    // here as it leaves, it's lost from tracking forever — including from
    // idsLeavingLiveContext above, which by the time the run eventually ends
    // into self-paced/idle only remembers the *last* active set, not this
    // long-superseded one. Left unhandled, the stale local answer can then
    // resurface and retry under whatever context comes later, silently
    // overwriting a legitimate draft for the same question. See "a staged
    // run's superseded question does not resurrect a stale answer after the
    // run ends".
    const deactivatedIds = hasObservedSnapshot
      ? previousActiveIds.filter((questionId) => !activeIds.includes(questionId))
      : []
    const didRunRestart = hasActiveQuestionRunRestart({
      hasObservedSnapshot,
      activeQuestionIds: activeIds,
      activeQuestionRunRevision: snapshot.activeQuestionRunRevision,
      previousActiveQuestionRunRevision: previousActiveQuestionRunRevisionRef.current,
    })

    if (reactivatedIds.length > 0 || didRunRestart || deactivatedIds.length > 0) {
      const restartedIds = Array.from(new Set([
        ...(didRunRestart ? activeIds : reactivatedIds),
        ...deactivatedIds,
      ]))
      setSubmittedQuestionIds((current) => {
        const next = new Set(current)
        for (const questionId of restartedIds) {
          next.delete(questionId)
        }
        return next
      })
      setSubmittedAnswers((current) => resetAnswersForRestartedQuestions({
        submittedAnswers: current,
        questionIdsToReset: restartedIds,
      }))
      clearDraftTracking({
        unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
        inFlightDraftQuestionIds: inFlightDraftQuestionIdsRef.current,
        unconfirmedQuestionRunRevisions: unconfirmedQuestionRunRevisionsRef.current,
        questionIds: restartedIds,
      })
    }
    hasObservedSnapshotRef.current = true
    previousActiveQuestionIdsRef.current = activeIds
    previousActiveQuestionRunRevisionRef.current = snapshot.activeQuestionRunRevision

    if (activeIds.length === 0) {
      setSelectedQuestionId(null)
      return
    }

    setSelectedQuestionId((current) => (current && activeIds.includes(current) ? current : activeIds[0] ?? null))
  }, [snapshot])

  // Attempts to (re)send one question's *current* answer, surviving
  // QuestionView being remounted on every stack-tab switch (see issue #374).
  // Always reads the value fresh at call time, never a captured historical
  // one, so a retry can never race an edit into producing a wrong result —
  // no generation/ordering bookkeeping is needed for the send itself. Called
  // both from the edit-triggered debounce and the periodic retry below.
  //
  // Deliberately does not skip sending once the run's deadline has passed:
  // the server is the actual authority on whether a draft still counts (see
  // its own deadlineAt check in the update-draft handler), and a rejected
  // late send is a harmless no-op, but guessing "too late" here on the
  // client's own clock risks dropping an edit still in flight right at the
  // boundary — the exact failure mode issue #374 was about.
  const attemptDraftSend = useCallback((questionId: string) => {
    const currentSnapshot = snapshotRef.current
    if (
      currentSnapshot === null ||
      inFlightDraftQuestionIdsRef.current.has(questionId) ||
      !unconfirmedQuestionIdsRef.current.has(questionId) ||
      submittedQuestionIdsRef.current.has(questionId) ||
      !isDraftStillCurrentForRevision({
        unconfirmedQuestionRunRevisions: unconfirmedQuestionRunRevisionsRef.current,
        questionId,
        currentRunRevision: currentSnapshot.activeQuestionRunRevision,
      })
    ) {
      return
    }

    const answer = submittedAnswersRef.current[questionId] ?? null
    const sentRunRevision = currentSnapshot.activeQuestionRunRevision
    const sentEditSequence = resolveCurrentEditSequence(
      editSequenceByKeyRef.current,
      questionId,
      sentRunRevision,
    )
    const attemptToken = ++nextDraftAttemptTokenRef.current
    inFlightDraftQuestionIdsRef.current.set(questionId, attemptToken)
    void saveDraft({
      studentId: studentIdRef.current,
      questionId,
      activeQuestionRunRevision: sentRunRevision,
      editSequence: sentEditSequence,
      draftSendSequence: ++nextDraftSendSequenceRef.current,
      answer,
    }).then((saved) => {
      // Only clear the in-flight marker if it still belongs to this attempt.
      // If this attempt was abandoned (clearDraftTracking, e.g. on submit or
      // run restart) and a fresh attempt already started for this question,
      // the marker now belongs to that newer attempt — this settlement must
      // not clear it out from under it, or the retry guard would let an
      // overlapping duplicate send start while the newer attempt is still
      // genuinely outstanding.
      if (inFlightDraftQuestionIdsRef.current.get(questionId) === attemptToken) {
        inFlightDraftQuestionIdsRef.current.delete(questionId)
      }
      if (!saved) return
      // An ack can arrive after the run has since restarted/reactivated
      // (this same question, a coincidentally identical answer). Only clear
      // the unconfirmed marker if the run revision and edit sequence in
      // effect *now* still match what was actually sent — content equality
      // alone can't tell "this ack is for the current attempt" from "this
      // ack is a stale confirmation from a superseded run or edit session."
      // (A stale ack from a *different* session/student identity can't reach
      // here at all: useResonanceSession's `saveDraft` only ever resolves
      // `true` from its own socket's `onmessage`, which is gated by
      // `isCurrent()` — a message on an abandoned socket, from before a
      // session/student change tore it down, is dropped before it's even
      // parsed. See "a stale acknowledgement delivered on an abandoned
      // identity's connection..." below.)
      const snapshotAtAck = snapshotRef.current
      if (snapshotAtAck === null || snapshotAtAck.activeQuestionRunRevision !== sentRunRevision) return
      const currentEditSequence = resolveCurrentEditSequence(
        editSequenceByKeyRef.current,
        questionId,
        snapshotAtAck.activeQuestionRunRevision,
      )
      const currentAnswer = submittedAnswersRef.current[questionId] ?? null
      if (currentEditSequence === sentEditSequence && isSameAnswer(currentAnswer, answer)) {
        unconfirmedQuestionIdsRef.current.delete(questionId)
      }
    })
  }, [saveDraft])

  // Fires an attempt shortly after the student stops typing a given
  // question, independent of the periodic retry's fixed schedule below —
  // without this, an edit made shortly before a deadline could wait up to
  // DRAFT_RETRY_INTERVAL_MS for the next tick, which might not arrive before
  // the deadline passes.
  const scheduleDraftSend = useCallback((questionId: string) => {
    const existingTimeoutId = draftSendTimeoutsRef.current.get(questionId)
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId)
    }
    // Bound the debounce to whatever time is actually left before the run's
    // deadline (see DRAFT_DEADLINE_BUFFER_MS) instead of always waiting the
    // full DRAFT_EDIT_DEBOUNCE_MS — an edit made right at (or past) the
    // boundary must still get a real chance to arrive before the server's
    // own deadline check does, clamped to an effectively-immediate send
    // rather than a negative/zero delay.
    const deadlineAt = snapshotRef.current?.activeQuestionDeadlineAt ?? null
    const remainingBeforeDeadline = deadlineAt === null ? null : deadlineAt - Date.now()
    const delayMs = remainingBeforeDeadline === null
      ? DRAFT_EDIT_DEBOUNCE_MS
      : Math.max(0, Math.min(DRAFT_EDIT_DEBOUNCE_MS, remainingBeforeDeadline - DRAFT_DEADLINE_BUFFER_MS))
    draftSendTimeoutsRef.current.set(questionId, window.setTimeout(() => {
      draftSendTimeoutsRef.current.delete(questionId)
      attemptDraftSend(questionId)
    }, delayMs))
  }, [attemptDraftSend])

  // Backstop retry for anything the edit-triggered debounce didn't manage to
  // get confirmed (a failed send, a disconnect, ...), and the trigger for
  // reconciling from the server once a draft is still unconfirmed past its
  // run's deadline.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const currentSnapshot = snapshotRef.current
      if (currentSnapshot === null) return

      const questionIdsStillUnconfirmed = selectUnconfirmedDraftQuestionIds({
        activeQuestionIds: currentSnapshot.activeQuestions.map((question) => question.id),
        submittedQuestionIds: submittedQuestionIdsRef.current,
        unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
      })

      const isPastDeadline =
        currentSnapshot.activeQuestionDeadlineAt !== null &&
        Date.now() >= currentSnapshot.activeQuestionDeadlineAt

      if (isPastDeadline && questionIdsStillUnconfirmed.length > 0) {
        const reconciliationKey = {
          revision: currentSnapshot.activeQuestionRunRevision,
          deadlineAt: currentSnapshot.activeQuestionDeadlineAt,
        }
        const matchesReconciliationKey = (
          key: { revision: number | null; deadlineAt: number | null } | null,
        ): boolean =>
          key !== null && key.revision === reconciliationKey.revision && key.deadlineAt === reconciliationKey.deadlineAt
        const alreadyReconciled = matchesReconciliationKey(reconciledExpiryRef.current)
        const reconciliationInFlight = matchesReconciliationKey(inFlightReconciliationRef.current)
        if (!alreadyReconciled && !reconciliationInFlight) {
          inFlightReconciliationRef.current = reconciliationKey
          void refresh().then((succeeded) => {
            // A newer reconciliation attempt (a later run/deadline) may have
            // already superseded this one by the time refresh() settles —
            // don't let a stale settlement clear a newer attempt's in-flight
            // marker or apply this attempt's now-stale reset, mirroring the
            // same stale-settlement guard attemptDraftSend already uses for
            // its own in-flight marker.
            if (!matchesReconciliationKey(inFlightReconciliationRef.current)) return
            inFlightReconciliationRef.current = null
            if (!succeeded) return
            // Only now — once refresh() has actually pulled whatever the
            // server finalized — stop trusting our own optimistic local
            // value for a draft that never got confirmed before the
            // deadline (the snapshot-merge effect above only lets the
            // server's value win when there's no local entry) and mark this
            // run's deadline reconciled. A failed refresh() must not do
            // either: it would strand the client trusting a stale local
            // value with no further reconciliation attempt for this run,
            // since reconciledExpiryRef would already claim it's handled.
            reconciledExpiryRef.current = reconciliationKey
            clearDraftTracking({
              unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
              inFlightDraftQuestionIds: inFlightDraftQuestionIdsRef.current,
              unconfirmedQuestionRunRevisions: unconfirmedQuestionRunRevisionsRef.current,
              questionIds: questionIdsStillUnconfirmed,
            })
            setSubmittedAnswers((current) => resetAnswersForRestartedQuestions({
              submittedAnswers: current,
              questionIdsToReset: questionIdsStillUnconfirmed,
            }))
            setAnswerReconciliationGeneration((current) => {
              const next = { ...current }
              for (const questionId of questionIdsStillUnconfirmed) {
                next[questionId] = (next[questionId] ?? 0) + 1
              }
              return next
            })
          })
        }
      }

      for (const questionId of questionIdsStillUnconfirmed) {
        attemptDraftSend(questionId)
      }
    }, DRAFT_RETRY_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [attemptDraftSend, refresh])

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
                          const isRevisit = !snapshot.selfPacedMode && submittedQuestionIds.has(question.id)
                          setSubmittedQuestionIds((current) => clearLiveQuestionSubmission({
                            selfPacedMode: snapshot.selfPacedMode,
                            submittedQuestionIds: current,
                            questionId: question.id,
                          }))
                          if (isRevisit) {
                            editSequenceByKeyRef.current = advanceEditSequenceForRevisit(
                              editSequenceByKeyRef.current,
                              question.id,
                              snapshot.activeQuestionRunRevision,
                            )
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
                key={`${activeQuestion.id}:${answerReconciliationGeneration[activeQuestion.id] ?? 0}`}
                question={activeQuestion}
                sessionId={sessionId}
                studentId={studentId}
                initialAnswer={resolveQuestionAnswer({
                  localAnswers: submittedAnswers,
                  snapshotAnswers: snapshot.submittedAnswers,
                  questionId: activeQuestion.id,
                })}
                activeQuestionRunRevision={snapshot.activeQuestionRunRevision}
                editSequence={resolveCurrentEditSequence(
                  editSequenceByKeyRef.current,
                  activeQuestion.id,
                  snapshot.activeQuestionRunRevision,
                )}
                disabled={hasExpired}
                isSubmitted={submittedQuestionIds.has(activeQuestion.id)}
                submittedMessage={submittedMessage}
                announceSubmittedMessage={!snapshot.selfPacedMode}
                onDraftChanged={(questionId, answer) => {
                  unconfirmedQuestionIdsRef.current.add(questionId)
                  unconfirmedQuestionRunRevisionsRef.current.set(questionId, snapshot.activeQuestionRunRevision)
                  setSubmittedAnswers((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                  scheduleDraftSend(questionId)
                }}
                onSubmitted={(questionId, answer) => {
                  // A draft send from before submission may still be
                  // in-flight (unacked). Without also clearing it here, a
                  // student who immediately revisits and edits this question
                  // would have that new edit blocked from sending until the
                  // old attempt times out (see clearDraftTracking).
                  clearDraftTracking({
                    unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
                    inFlightDraftQuestionIds: inFlightDraftQuestionIdsRef.current,
                    unconfirmedQuestionRunRevisions: unconfirmedQuestionRunRevisionsRef.current,
                    questionIds: [questionId],
                  })
                  setSubmittedAnswers((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                  setSubmittedQuestionIds((current) => {
                    const nextSubmittedQuestionIds = new Set(current)
                    nextSubmittedQuestionIds.add(questionId)
                    const nextAnnouncement = resolveSubmissionAnnouncement({
                      selfPacedMode: snapshot.selfPacedMode,
                      questionIds: activeQuestions.map((question) => question.id),
                      submittedQuestionIds: nextSubmittedQuestionIds,
                      currentQuestionId: questionId,
                    })
                    if (nextAnnouncement) {
                      setSubmissionAnnouncement((currentAnnouncement) => ({
                        id: (currentAnnouncement?.id ?? 0) + 1,
                        message: nextAnnouncement,
                      }))
                    }
                    if (snapshot.selfPacedMode) {
                      setSelectedQuestionId((currentQuestionId) => resolveNextSelfPacedQuestionId({
                        questionIds: activeQuestions.map((question) => question.id),
                        submittedQuestionIds: nextSubmittedQuestionIds,
                        currentQuestionId: currentQuestionId ?? questionId,
                      }))
                    }
                    return nextSubmittedQuestionIds
                  })
                }}
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
