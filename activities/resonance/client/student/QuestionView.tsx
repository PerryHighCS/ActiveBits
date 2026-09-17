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
  activeQuestionRunRevision?: number | null
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
  onSubmitted?(questionId: string, answer: AnswerPayload): void
}

export function isSameAnswer(left: AnswerPayload | null, right: AnswerPayload | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (left.type !== right.type) return false
  return left.type === 'free-response'
    ? right.type === 'free-response' && left.text === right.text
    : right.type === 'multiple-choice' &&
        areMcqSelectionsEqual(left.selectedOptionIds, right.selectedOptionIds)
}

/**
 * Renders one question's answer input and handles its own submission.
 *
 * This component does not persist drafts itself: every value change is
 * reported to the parent via `onDraftChanged` immediately, and the parent
 * (ResonanceStudent) owns sending and retrying that value until the server
 * confirms it. That split exists because this component is deliberately
 * remounted on every stack-tab switch (keyed by question id) — a save/retry
 * mechanism owned here would lose its state on every switch, which is what
 * caused unconfirmed drafts to go unretried and get lost (issue #374). The
 * parent has the right lifetime to own that instead.
 */
export default function QuestionView({
  question,
  sessionId,
  studentId,
  initialAnswer = null,
  activeQuestionRunRevision = null,
  disabled = false,
  isSubmitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
  editSequence = 1,
  onDraftChanged,
  onSubmitted,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAnswer, setDraftAnswer] = useState<AnswerPayload | null>(initialAnswer)
  const initialAnswerRef = useRef(initialAnswer)
  const synchronizedInitialAnswerRef = useRef(initialAnswer)
  const submissionAttemptRef = useRef(0)
  const activeQuestionRunRevisionRef = useRef(activeQuestionRunRevision)
  // Mirrors the editSequence prop so submitAnswer (defined below, outside the
  // render body) always reads the current value without needing it in a
  // dependency array.
  const editSequenceRef = useRef(editSequence)
  // QuestionView isn't remounted on an identity change (it's keyed only by
  // question id), so a submission in flight under a prior sessionId/studentId
  // (e.g. recovering a lost participant capability mid-edit) must not be
  // allowed to land under the new identity.
  const sessionIdRef = useRef(sessionId)
  const studentIdRef = useRef(studentId)
  initialAnswerRef.current = initialAnswer
  activeQuestionRunRevisionRef.current = activeQuestionRunRevision
  editSequenceRef.current = editSequence
  sessionIdRef.current = sessionId
  studentIdRef.current = studentId
  const isWaitingForChoices =
    question.type === 'multiple-choice' && question.choicesRevealed === false

  useEffect(() => {
    setDraftAnswer(initialAnswerRef.current)
    synchronizedInitialAnswerRef.current = initialAnswerRef.current
  }, [question.id, activeQuestionRunRevision, isSubmitted, sessionId, studentId])

  useEffect(() => {
    submissionAttemptRef.current += 1
    setSubmitting(false)
    setError(null)
    return () => {
      submissionAttemptRef.current += 1
    }
  }, [question.id, activeQuestionRunRevision, sessionId, studentId])

  useEffect(() => {
    if (isSameAnswer(draftAnswer, synchronizedInitialAnswerRef.current)) {
      setDraftAnswer(initialAnswer)
      synchronizedInitialAnswerRef.current = initialAnswer
    }
  }, [draftAnswer, initialAnswer])

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
          activeQuestionRunRevision: submissionRunRevision,
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
      synchronizedInitialAnswerRef.current = answer
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
