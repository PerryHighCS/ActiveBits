import { useEffect, useRef, useState } from 'react'
import type { AnswerPayload, StudentQuestion } from '../../shared/types.js'
import { areMcqSelectionsEqual } from '../../shared/mcq.js'
import { runIdentitiesMatch, type RunIdentitySource } from '../../shared/runIdentity.js'
import FormattedMarkdown from '../components/FormattedMarkdown.js'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'

interface Props {
  question: StudentQuestion
  sessionId: string
  studentId: string
  initialAnswer?: AnswerPayload | null
  activeQuestionRunStartedAt?: number | null
  activeQuestionRunRevision?: number | null
  activeQuestionDeadlineAt?: number | null
  disabled?: boolean
  isSubmitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
  /**
   * Monotonic edit-session counter for this question/run, owned by the
   * parent so it survives this component remounting (the parent keys
   * QuestionView by question id, so switching stack tabs away and back
   * remounts it with fresh local state). The parent bumps it when the
   * student revisits an already-submitted question in the same run; the
   * server uses it to tell that legitimate revision apart from a draft that
   * predates an existing submission. Defaults to 1 (the baseline for a
   * question's first edit session in a run) when omitted.
   */
  editSequence?: number
  nextDraftGeneration?(questionId: string, activeQuestionRunToken: number | null): number
  draftResetVersion?: number
  onDraftChanged?(questionId: string, answer: AnswerPayload | null): void
  onDraftSaveFailed?(payload: Record<string, unknown>): void
  onDraftSaved?(payload: Record<string, unknown>): void
  /**
   * `runIdentity` is the run this submission was sent under — not
   * necessarily the current one, since this can fire after this view has
   * unmounted (a stack-tab switch) and the parent's own state has moved on.
   * The parent uses it, together with its own knowledge of the current local
   * answer, to independently verify this response is still fresh before
   * applying it, rather than trusting this view's own (possibly
   * stale/frozen) checks. Carries both run-identity fields (not a single
   * resolved token) so the parent can recognize a legacy-timestamp
   * submission as equivalent to a since-canonicalized revision-1 run via the
   * same runIdentitiesMatch bridge used everywhere else, instead of a raw
   * scalar comparison that a legacy/canonical migration would defeat.
   */
  onSubmitted?(questionId: string, answer: AnswerPayload, runIdentity: RunIdentitySource): void
  sendMessage?(type: string, payload: unknown): boolean
  saveDraft?(payload: Record<string, unknown>): Promise<boolean>
}

const DRAFT_PUSH_DELAY_MS = 1500
const DRAFT_DEADLINE_BUFFER_MS = 100

function isSameAnswer(left: AnswerPayload | null, right: AnswerPayload | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (left.type !== right.type) return false
  return left.type === 'free-response'
    ? right.type === 'free-response' && left.text === right.text
    : right.type === 'multiple-choice' &&
        areMcqSelectionsEqual(left.selectedOptionIds, right.selectedOptionIds)
}

export default function QuestionView({
  question,
  sessionId,
  studentId,
  initialAnswer = null,
  activeQuestionRunStartedAt = null,
  activeQuestionRunRevision = null,
  activeQuestionDeadlineAt = null,
  disabled = false,
  isSubmitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
  editSequence = 1,
  nextDraftGeneration,
  draftResetVersion = 0,
  onDraftChanged,
  onDraftSaveFailed,
  onDraftSaved,
  onSubmitted,
  sendMessage,
  saveDraft,
}: Props) {
  const activeQuestionRunToken = activeQuestionRunRevision ?? activeQuestionRunStartedAt
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAnswer, setDraftAnswer] = useState<AnswerPayload | null>(initialAnswer)
  const draftAnswerRef = useRef(draftAnswer)
  const lastSentDraftRef = useRef<AnswerPayload | null>(null)
  const draftGenerationRef = useRef(0)
  const initialAnswerRef = useRef(initialAnswer)
  const synchronizedInitialAnswerRef = useRef(initialAnswer)
  const submissionAttemptRef = useRef(0)
  // Snapshot the submission-invalidation effect below compares each run
  // against, to tell a genuine question/session/student/run change from a
  // same-run legacy-to-canonical relabel (see that effect's own comment).
  const submissionInvalidationRef = useRef<{
    questionId: string
    sessionId: string
    studentId: string
    identity: RunIdentitySource
  }>({
    questionId: question.id,
    sessionId,
    studentId,
    identity: { activeQuestionRunRevision, activeQuestionRunStartedAt },
  })
  const disabledRef = useRef(disabled)
  const activeQuestionRunRevisionRef = useRef(activeQuestionRunToken)
  // Unlike activeQuestionRunRevisionRef (a resolved scalar, used for the
  // draft-save "is this still the current run" checks below), this keeps
  // both raw identity fields — needed only where a legacy-timestamp run must
  // still be recognized as equivalent to its since-canonicalized revision-1
  // form (see submitAnswer's own stale-response guard and onSubmitted).
  // Collapsing to a scalar first would lose which form produced it.
  const activeQuestionRunIdentityRef = useRef<RunIdentitySource>({
    activeQuestionRunRevision,
    activeQuestionRunStartedAt,
  })
  // Full identity (not a resolved scalar) of the run draftAnswer was last
  // captured/edited under, for the same reason activeQuestionRunIdentityRef
  // keeps both fields: a legacy-timestamp run being relabeled to its
  // since-canonicalized revision-1 form changes the resolved scalar even
  // though it's the same real run, and a scalar comparison would wrongly
  // treat that relabeling as a run change.
  const draftAnswerRunIdentityRef = useRef<RunIdentitySource>({
    activeQuestionRunRevision: null,
    activeQuestionRunStartedAt: null,
  })
  // Mirrors the editSequence prop so the debounced draft-push effect and
  // submitAnswer (both defined below, outside the render body) always read
  // the current value without needing it in their dependency arrays.
  const editSequenceRef = useRef(editSequence)
  // QuestionView isn't remounted on an identity change (it's keyed only by
  // question id), so an in-flight draft or ack scheduled under a prior
  // sessionId/studentId (e.g. recovering a lost participant capability mid-
  // edit) must not be allowed to land under the new identity.
  const sessionIdRef = useRef(sessionId)
  const studentIdRef = useRef(studentId)
  initialAnswerRef.current = initialAnswer
  draftAnswerRef.current = draftAnswer
  disabledRef.current = disabled
  activeQuestionRunRevisionRef.current = activeQuestionRunToken
  activeQuestionRunIdentityRef.current = { activeQuestionRunRevision, activeQuestionRunStartedAt }
  editSequenceRef.current = editSequence
  sessionIdRef.current = sessionId
  studentIdRef.current = studentId
  const isWaitingForChoices =
    question.type === 'multiple-choice' && question.choicesRevealed === false

  useEffect(() => {
    setDraftAnswer(initialAnswerRef.current)
    lastSentDraftRef.current = initialAnswerRef.current
    synchronizedInitialAnswerRef.current = initialAnswerRef.current
    draftAnswerRunIdentityRef.current = { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null }
  }, [draftResetVersion, question.id, activeQuestionRunToken, isSubmitted, sessionId, studentId])

  useEffect(() => {
    const previous = submissionInvalidationRef.current
    const currentIdentity: RunIdentitySource = { activeQuestionRunRevision, activeQuestionRunStartedAt }
    // A legacy-timestamp run relabeled to its since-canonicalized revision-1
    // form changes activeQuestionRunToken (a dependency below) even though
    // it's the same real run. Invalidating an in-flight submission's UI
    // state (submitting/error) on every token change — as a raw scalar
    // comparison would — abandons that submission's feedback mid-flight: the
    // button silently flips back to "not submitting" while the request is
    // still pending, inviting a confusing double-submit, and the eventual
    // response/failure has nothing left to report to. Only question,
    // session, and student identity changes are unconditional; a run
    // "change" that's really just a relabel of the same run is not one.
    const previousRunMatches = runIdentitiesMatch(previous.identity, currentIdentity)
    submissionInvalidationRef.current = { questionId: question.id, sessionId, studentId, identity: currentIdentity }
    if (
      previous.questionId === question.id &&
      previous.sessionId === sessionId &&
      previous.studentId === studentId &&
      previousRunMatches
    ) {
      return
    }
    submissionAttemptRef.current += 1
    setSubmitting(false)
    setError(null)
    return () => {
      submissionAttemptRef.current += 1
    }
  }, [question.id, activeQuestionRunToken, sessionId, studentId])

  // Closes a same-question run-restart race: the reset effect above fires
  // (activeQuestionRunToken changed) and seeds draftAnswer from whatever
  // initialAnswer the parent passed on ITS first render of the new run —
  // before the parent's own effect has cleared a stale prior-run local
  // answer out of that same prop. That correction lands here as a later
  // initialAnswer change; since draftAnswer still matches the value this
  // component last synchronized (the student hasn't typed anything new in
  // between), it's safe to resync to the corrected value rather than leaving
  // the stale one in place for the rest of the run.
  useEffect(() => {
    if (isSameAnswer(draftAnswer, synchronizedInitialAnswerRef.current)) {
      setDraftAnswer(initialAnswer)
      lastSentDraftRef.current = initialAnswer
      synchronizedInitialAnswerRef.current = initialAnswer
    }
  }, [draftAnswer, initialAnswer])

  useEffect(() => {
    const effectRunIdentity: RunIdentitySource = { activeQuestionRunRevision, activeQuestionRunStartedAt }
    const draftAnswerRunIdentity = draftAnswerRunIdentityRef.current
    if (
      !runIdentitiesMatch(draftAnswerRunIdentity, effectRunIdentity) ||
      disabled ||
      isWaitingForChoices ||
      isSubmitted ||
      (!saveDraft && !sendMessage) ||
      isSameAnswer(draftAnswer, lastSentDraftRef.current)
    ) {
      return
    }

    const pendingDraft = draftAnswer
    // Shared by every send/handoff below so a payload's shape (and its
    // draftGeneration allocation, a side effect of building one) only has
    // one implementation — previously duplicated three times, once per
    // handoff site, which is exactly how the handoff itself went missing
    // from a fourth site (the disabled-transition branch in the cleanup
    // below) until a later review round found it.
    const buildDraftPayload = (answer: AnswerPayload | null) => ({
      studentId,
      questionId: question.id,
      ...(activeQuestionRunRevision !== null
        ? { activeQuestionRunRevision: activeQuestionRunToken }
        : { activeQuestionRunStartedAt: activeQuestionRunToken }),
      ...(activeQuestionDeadlineAt !== null ? { activeQuestionDeadlineAt } : {}),
      editSequence: editSequenceRef.current,
      draftGeneration: nextDraftGeneration?.(question.id, activeQuestionRunToken) ?? ++draftGenerationRef.current,
      answer,
    })
    // The parent owns retry/deadline reconciliation once a value can no
    // longer reach the server through this view's own debounce — after a
    // save this component started is superseded, after a failure, or after
    // the deadline disables this view before its own debounce ever got to
    // run. In every case, handing the CURRENT (not the stale pending) value
    // off with a fresh generation is the one durable path.
    const handOffCurrentDraft = () => {
      const currentDraft = draftAnswerRef.current
      lastSentDraftRef.current = currentDraft
      onDraftSaveFailed?.(buildDraftPayload(currentDraft))
    }
    const sendDraft = () => {
      const payload = buildDraftPayload(pendingDraft)
      if (saveDraft) {
        void saveDraft(payload).then((saved) => {
          if (sessionIdRef.current !== sessionId || studentIdRef.current !== studentId) {
            return
          }
          const isCurrentRun = activeQuestionRunRevisionRef.current === activeQuestionRunToken
          if (saved) {
            if (isCurrentRun && isSameAnswer(draftAnswerRef.current, pendingDraft)) {
              lastSentDraftRef.current = pendingDraft
            }
            // A parent-retained older generation for this same question+run
            // (from an earlier failed save) is now superseded — without this,
            // it would keep being retried independently of this successful
            // one until some unrelated signal (a new snapshot, the deadline)
            // happened to clear it.
            onDraftSaved?.(payload)
            // A newer local edit can have replaced pendingDraft while this
            // save was in flight (the debounce for it is still pending, or
            // was just cancelled by this same re-render's effect cleanup).
            // That newer value isn't handed off anywhere else: it's not what
            // was just acknowledged above, and unlike the failure branch
            // below, success doesn't naturally trigger a retry. If the
            // deadline disables this view before its own debounce fires,
            // that edit would otherwise never reach the server at all.
            if (isCurrentRun && !isSameAnswer(draftAnswerRef.current, lastSentDraftRef.current)) {
              handOffCurrentDraft()
            }
            return
          }
          // QuestionView is keyed by question ID and unmounts when the
          // student switches stack tabs. The parent owns retry/reconciliation
          // so this failed write remains recoverable after that unmount. A
          // same-run failure superseded by a newer local edit is dropped here
          // — the next debounced send already covers it — but a failure from
          // a run that has since ended or changed must still be handed off:
          // this component's local state is no longer authoritative once the
          // run moves on, and only the parent's deadline-aware disposition
          // logic can decide whether to retry, reconcile, or discard it.
          if (!isCurrentRun || isSameAnswer(draftAnswerRef.current, pendingDraft)) {
            lastSentDraftRef.current = pendingDraft
            onDraftSaveFailed?.(payload)
          } else if (isCurrentRun && !isSameAnswer(draftAnswerRef.current, lastSentDraftRef.current)) {
            // A newer local value (including an intentional clear) replaced
            // this failed in-flight save. Hand that newest value directly to
            // the parent: restarting this effect would run its cleanup and
            // schedule a second debounce for the same value, and a deadline
            // can disable this view before that timer is allowed to run.
            handOffCurrentDraft()
          }
        })
        return
      }
      if (sendMessage?.('resonance:update-draft', payload)) {
        lastSentDraftRef.current = pendingDraft
      }
    }

    const remainingBeforeDeadline = activeQuestionDeadlineAt === null
      ? null
      : activeQuestionDeadlineAt - Date.now()
    if (remainingBeforeDeadline !== null && remainingBeforeDeadline <= 0) {
      return
    }
    const pushDelayMs = remainingBeforeDeadline === null
      ? DRAFT_PUSH_DELAY_MS
      : Math.max(0, Math.min(DRAFT_PUSH_DELAY_MS, remainingBeforeDeadline - DRAFT_DEADLINE_BUFFER_MS))
    const timeoutId = window.setTimeout(() => {
      sendDraft()
    }, pushDelayMs)

    return () => {
      window.clearTimeout(timeoutId)
      if (
        // A legacy-timestamp run relabeled to its since-canonicalized
        // revision-1 form changes the raw props (and therefore
        // activeQuestionRunToken) even though it's the same real run — a
        // scalar comparison here would treat that relabeling as a run
        // change and bail out without flushing or handing off the pending
        // edit, right before the reset effect above overwrites draftAnswer
        // with the parent's (possibly stale) initialAnswer.
        !runIdentitiesMatch(activeQuestionRunIdentityRef.current, effectRunIdentity) ||
        !runIdentitiesMatch(draftAnswerRunIdentity, effectRunIdentity) ||
        sessionIdRef.current !== sessionId ||
        studentIdRef.current !== studentId ||
        // On a draft value change React runs this cleanup before scheduling
        // the next debounce. The ref already holds the newer value, so do not
        // flush the previous keystroke; reserve flushing for actual unmount.
        !isSameAnswer(draftAnswerRef.current, pendingDraft) ||
        isSameAnswer(pendingDraft, lastSentDraftRef.current)
      ) {
        return
      }
      if (!disabledRef.current) {
        sendDraft()
        return
      }
      // The deadline disabled this view while this debounce was still
      // pending and nothing was in flight to catch it via the saveDraft
      // success/failure handoffs above (those only run once a promise
      // settles). Previously this branch did nothing at all — the pending
      // edit was silently dropped instead of hand off, indistinguishable
      // from "the debounce's own send lost the race to a throttled timer,"
      // a real risk for a backgrounded tab where the browser can delay
      // this timeout well past its nominal delay.
      handOffCurrentDraft()
    }
  }, [activeQuestionDeadlineAt, activeQuestionRunRevision, activeQuestionRunToken, disabled, draftAnswer, isSubmitted, isWaitingForChoices, nextDraftGeneration, onDraftSaveFailed, onDraftSaved, question.id, saveDraft, sendMessage, sessionId, studentId])

  async function submitAnswer(
    answer: { type: 'free-response'; text: string } | { type: 'multiple-choice'; selectedOptionIds: string[] },
  ) {
    if (disabled || isSubmitted || isWaitingForChoices) {
      return
    }

    setSubmitting(true)
    setError(null)
    const submissionAttempt = ++submissionAttemptRef.current
    const submissionRunRevision = activeQuestionRunRevisionRef.current
    const submissionRunIdentity = activeQuestionRunIdentityRef.current

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          questionId: question.id,
          ...(activeQuestionRunRevision !== null
            ? { activeQuestionRunRevision: submissionRunRevision }
            : { activeQuestionRunStartedAt: submissionRunRevision }),
          editSequence: editSequenceRef.current,
          answer,
        }),
      })

      const data = (await resp.json()) as { ok?: boolean; error?: string }

      // A stale run or participant identity means this response no longer
      // means what it did when the request was sent (e.g. the run restarted
      // while this view stayed mounted) — never act on it. Plain unmount
      // (the student switched stack tabs before the response came back)
      // does *not* invalidate it: refs still hold the values from this
      // view's last render, so both checks still pass in that case.
      //
      // runIdentitiesMatch (not a raw !==) so a request sent while this run
      // was still in legacy timestamp-only form is still recognized once a
      // later snapshot canonicalizes that same run to revision 1 — a raw
      // scalar comparison would otherwise treat that migration alone as a
      // run change and drop an entirely valid, already-persisted submission.
      if (
        !runIdentitiesMatch(activeQuestionRunIdentityRef.current, submissionRunIdentity) ||
        sessionIdRef.current !== sessionId ||
        studentIdRef.current !== studentId
      ) {
        return
      }

      if (!resp.ok) {
        if (submissionAttempt === submissionAttemptRef.current) {
          setError(data.error ?? 'Submission failed — please try again')
          setSubmitting(false)
        }
        return
      }

      // The server persisted this submission even if this view has since
      // unmounted — the parent owns retained-draft/edit-sequence bookkeeping
      // across that unmount (QuestionView is remounted on every stack-tab
      // switch) and must still be told, or a retained failed autosave for
      // this question would keep retrying indefinitely instead of being
      // recognized as superseded.
      onSubmitted?.(question.id, answer, submissionRunIdentity)
      if (submissionAttempt === submissionAttemptRef.current) {
        setDraftAnswer(answer)
        lastSentDraftRef.current = answer
        draftAnswerRunIdentityRef.current = { activeQuestionRunRevision, activeQuestionRunStartedAt }
      }
    } catch {
      // runIdentitiesMatch (not a raw scalar ===), matching the success path
      // above: a legacy-to-canonical relabel of the SAME run while this
      // fetch was in flight must not be mistaken for a run change. Before
      // this fix, that relabel made this check fail, suppressing the error
      // and leaving submitting stuck at true even though the request had
      // genuinely failed.
      if (
        submissionAttempt === submissionAttemptRef.current &&
        runIdentitiesMatch(activeQuestionRunIdentityRef.current, submissionRunIdentity) &&
        sessionIdRef.current === sessionId &&
        studentIdRef.current === studentId
      ) {
        setError('Network error — please try again')
      }
    } finally {
      if (
        submissionAttempt === submissionAttemptRef.current &&
        runIdentitiesMatch(activeQuestionRunIdentityRef.current, submissionRunIdentity) &&
        sessionIdRef.current === sessionId &&
        studentIdRef.current === studentId
      ) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Question text */}
      <FormattedMarkdown
        markdown={question.text}
        className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug"
      />

      {/* Answer input */}
      {question.type === 'free-response' ? (
        <FreeResponseInput
          value={draftAnswer?.type === 'free-response' ? draftAnswer.text : ''}
          onDraftChange={(text) => {
            const trimmed = text.trim()
            const answer = trimmed.length > 0 ? { type: 'free-response' as const, text: trimmed } : null
            draftAnswerRunIdentityRef.current = { activeQuestionRunRevision, activeQuestionRunStartedAt }
            setDraftAnswer(answer)
            onDraftChanged?.(question.id, answer)
          }}
          onSubmit={(text) => submitAnswer({ type: 'free-response', text })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      ) : isWaitingForChoices ? null : (
        <MCQInput
          options={question.options}
          selectionMode={question.selectionMode}
          value={draftAnswer?.type === 'multiple-choice' ? draftAnswer.selectedOptionIds : []}
          onDraftChange={(selectedOptionIds) => {
            const answer = selectedOptionIds.length > 0
              ? { type: 'multiple-choice' as const, selectedOptionIds }
              : null
            draftAnswerRunIdentityRef.current = { activeQuestionRunRevision, activeQuestionRunStartedAt }
            setDraftAnswer(answer)
            onDraftChanged?.(question.id, answer)
          }}
          onSubmit={(selectedOptionIds) => submitAnswer({ type: 'multiple-choice', selectedOptionIds })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      )}

      {error !== null && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {disabled && (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          Time is up for this activity.
        </p>
      )}
    </div>
  )
}
