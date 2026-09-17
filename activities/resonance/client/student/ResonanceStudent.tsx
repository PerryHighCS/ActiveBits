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
 */
export function seedEditSequenceFromConfirmedResponse(
  editSequenceByKey: Record<string, number>,
  questionId: string,
  runToken: number | null,
  confirmedEditSequence: number,
): Record<string, number> {
  const key = buildEditSequenceKey(questionId, runToken)
  const floor = confirmedEditSequence + 1
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
  questionIds: readonly string[]
}): void {
  for (const questionId of params.questionIds) {
    params.unconfirmedQuestionIds.delete(questionId)
    params.inFlightDraftQuestionIds.delete(questionId)
  }
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
  // Maps a question id to a token identifying whichever attemptDraftSend call
  // is currently outstanding for it. A plain presence flag isn't enough: if
  // attempt A is abandoned (clearDraftTracking) while still outstanding and a
  // fresh attempt B then starts before A's saveDraft() promise settles, A's
  // eventual settlement must not clear B's in-flight marker — only a
  // settlement that still owns the current token may clear the entry.
  const inFlightDraftQuestionIdsRef = useRef<Map<string, number>>(new Map())
  const nextDraftAttemptTokenRef = useRef(0)
  // Per-question debounce timers that trigger an edit-triggered send attempt
  // shortly after the student stops typing (see DRAFT_EDIT_DEBOUNCE_MS).
  const draftSendTimeoutsRef = useRef<Map<string, number>>(new Map())
  // Tracks the {revision, deadlineAt} pair already reconciled via refresh(),
  // so a still-unconfirmed draft past its deadline triggers at most one
  // refresh per run rather than one every retry-loop tick.
  const reconciledExpiryRef = useRef<{ revision: number | null; deadlineAt: number | null } | null>(null)
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
    setSubmissionAnnouncement(null)
    previousActiveQuestionIdsRef.current = []
    previousActiveQuestionRunRevisionRef.current = null
    hasObservedSnapshotRef.current = false
    editSequenceByKeyRef.current = {}
    unconfirmedQuestionIdsRef.current = new Set()
    inFlightDraftQuestionIdsRef.current = new Map()
    for (const timeoutId of draftSendTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId)
    }
    draftSendTimeoutsRef.current.clear()
    reconciledExpiryRef.current = null
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

    setSubmittedAnswers((current) => ({
      ...snapshot.draftAnswers,
      ...snapshot.submittedAnswers,
      ...current,
    }))

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
        )
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
    })

    if (reactivatedIds.length > 0 || didRunRestart) {
      const restartedIds = didRunRestart ? activeIds : reactivatedIds
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
      submittedQuestionIdsRef.current.has(questionId)
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
    draftSendTimeoutsRef.current.set(questionId, window.setTimeout(() => {
      draftSendTimeoutsRef.current.delete(questionId)
      attemptDraftSend(questionId)
    }, DRAFT_EDIT_DEBOUNCE_MS))
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
        const alreadyReconciled =
          reconciledExpiryRef.current !== null &&
          reconciledExpiryRef.current.revision === reconciliationKey.revision &&
          reconciledExpiryRef.current.deadlineAt === reconciliationKey.deadlineAt
        if (!alreadyReconciled) {
          reconciledExpiryRef.current = reconciliationKey
          // Stop trusting our own optimistic local value for a draft that
          // never got confirmed before the deadline — refresh() below pulls
          // whatever the server actually finalized, and the snapshot-merge
          // effect above only lets that win when there's no local entry.
          clearDraftTracking({
            unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current,
            inFlightDraftQuestionIds: inFlightDraftQuestionIdsRef.current,
            questionIds: questionIdsStillUnconfirmed,
          })
          setSubmittedAnswers((current) => resetAnswersForRestartedQuestions({
            submittedAnswers: current,
            questionIdsToReset: questionIdsStillUnconfirmed,
          }))
          void refresh()
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
                key={activeQuestion.id}
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
