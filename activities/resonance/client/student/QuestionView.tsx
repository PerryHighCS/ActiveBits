import { useEffect, useRef, useState } from 'react'
import type { AnswerPayload, StudentQuestion } from '../../shared/types.js'
import { areMcqSelectionsEqual } from '../../shared/mcq.js'
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
  onDraftChanged?(questionId: string, answer: AnswerPayload | null): void
  onDraftSaveFailed?(payload: Record<string, unknown>): void
  onSubmitted?(questionId: string, answer: AnswerPayload): void
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
  onDraftChanged,
  onDraftSaveFailed,
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
  const disabledRef = useRef(disabled)
  const activeQuestionRunRevisionRef = useRef(activeQuestionRunToken)
  const draftAnswerRunRevisionRef = useRef<number | null>(null)
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
  editSequenceRef.current = editSequence
  sessionIdRef.current = sessionId
  studentIdRef.current = studentId
  const isWaitingForChoices =
    question.type === 'multiple-choice' && question.choicesRevealed === false

  useEffect(() => {
    setDraftAnswer(initialAnswerRef.current)
    lastSentDraftRef.current = initialAnswerRef.current
    synchronizedInitialAnswerRef.current = initialAnswerRef.current
    draftAnswerRunRevisionRef.current = null
  }, [question.id, activeQuestionRunToken, isSubmitted, sessionId, studentId])

  useEffect(() => {
    submissionAttemptRef.current += 1
    setSubmitting(false)
    setError(null)
    return () => {
      submissionAttemptRef.current += 1
    }
  }, [question.id, activeQuestionRunToken, sessionId, studentId])

  useEffect(() => {
    if (isSameAnswer(draftAnswer, synchronizedInitialAnswerRef.current)) {
      setDraftAnswer(initialAnswer)
      lastSentDraftRef.current = initialAnswer
      synchronizedInitialAnswerRef.current = initialAnswer
    }
  }, [draftAnswer, initialAnswer])

  useEffect(() => {
    const draftAnswerRunRevision = draftAnswerRunRevisionRef.current
    if (
      draftAnswerRunRevision !== activeQuestionRunToken ||
      disabled ||
      isWaitingForChoices ||
      isSubmitted ||
      (!saveDraft && !sendMessage) ||
      isSameAnswer(draftAnswer, lastSentDraftRef.current)
    ) {
      return
    }

    const pendingDraft = draftAnswer
    const sendDraft = () => {
      const payload = {
        studentId,
        questionId: question.id,
        ...(activeQuestionRunRevision !== null
          ? { activeQuestionRunRevision: activeQuestionRunToken }
          : { activeQuestionRunStartedAt: activeQuestionRunToken }),
        editSequence: editSequenceRef.current,
        draftGeneration: ++draftGenerationRef.current,
        answer: pendingDraft,
      }
      if (saveDraft) {
        void saveDraft(payload).then((saved) => {
          if (
            activeQuestionRunRevisionRef.current !== activeQuestionRunToken ||
            sessionIdRef.current !== sessionId ||
            studentIdRef.current !== studentId ||
            !isSameAnswer(draftAnswerRef.current, pendingDraft)
          ) {
            return
          }
          if (saved) {
            lastSentDraftRef.current = pendingDraft
          } else {
            // QuestionView is keyed by question ID and unmounts when the
            // student switches stack tabs. The parent owns retry/reconciliation
            // so this failed write remains recoverable after that unmount.
            onDraftSaveFailed?.(payload)
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
        activeQuestionRunRevisionRef.current === activeQuestionRunToken &&
        draftAnswerRunRevision === activeQuestionRunToken &&
        sessionIdRef.current === sessionId &&
        studentIdRef.current === studentId &&
        !disabledRef.current &&
        // On a draft value change React runs this cleanup before scheduling
        // the next debounce. The ref already holds the newer value, so do not
        // flush the previous keystroke; reserve flushing for actual unmount.
        isSameAnswer(draftAnswerRef.current, pendingDraft) &&
        !isSameAnswer(pendingDraft, lastSentDraftRef.current)
      ) {
        sendDraft()
      }
    }
  }, [activeQuestionDeadlineAt, activeQuestionRunRevision, activeQuestionRunToken, disabled, draftAnswer, isSubmitted, isWaitingForChoices, onDraftSaveFailed, question.id, saveDraft, sendMessage, sessionId, studentId])

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

      if (
        submissionAttempt !== submissionAttemptRef.current ||
        submissionRunRevision !== activeQuestionRunRevisionRef.current ||
        sessionIdRef.current !== sessionId ||
        studentIdRef.current !== studentId
      ) {
        return
      }

      if (!resp.ok) {
        setError(data.error ?? 'Submission failed — please try again')
        setSubmitting(false)
        return
      }

      onSubmitted?.(question.id, answer)
      setDraftAnswer(answer)
      lastSentDraftRef.current = answer
      draftAnswerRunRevisionRef.current = activeQuestionRunToken
    } catch {
      if (
        submissionAttempt === submissionAttemptRef.current &&
        submissionRunRevision === activeQuestionRunRevisionRef.current &&
        sessionIdRef.current === sessionId &&
        studentIdRef.current === studentId
      ) {
        setError('Network error — please try again')
      }
    } finally {
      if (
        submissionAttempt === submissionAttemptRef.current &&
        submissionRunRevision === activeQuestionRunRevisionRef.current &&
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
            draftAnswerRunRevisionRef.current = activeQuestionRunToken
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
            draftAnswerRunRevisionRef.current = activeQuestionRunToken
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
