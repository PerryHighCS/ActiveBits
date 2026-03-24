import { useEffect, useRef, useState } from 'react'
import type { AnswerPayload, StudentQuestion } from '../../shared/types.js'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'

interface Props {
  question: StudentQuestion
  sessionId: string
  studentId: string
  initialAnswer?: AnswerPayload | null
  disabled?: boolean
  isSubmitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
  onSubmitted?(questionId: string, answer: AnswerPayload): void
  sendMessage?(type: string, payload: unknown): boolean
}

/**
 * Renders the active question and the appropriate answer input.
 * Submission goes to POST /api/resonance/:sessionId/submit-answer.
 * Phase 7 will add a WebSocket path alongside this REST fallback.
 */
const DRAFT_PUSH_DELAY_MS = 1500

function isSameAnswer(left: AnswerPayload | null, right: AnswerPayload | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (left.type !== right.type) return false
  return left.type === 'free-response'
    ? right.type === 'free-response' && left.text === right.text
    : right.type === 'multiple-choice' && left.selectedOptionId === right.selectedOptionId
}

export default function QuestionView({
  question,
  sessionId,
  studentId,
  initialAnswer = null,
  disabled = false,
  isSubmitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
  onSubmitted,
  sendMessage,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAnswer, setDraftAnswer] = useState<AnswerPayload | null>(initialAnswer)
  const lastSentDraftRef = useRef<AnswerPayload | null>(null)

  useEffect(() => {
    setDraftAnswer(initialAnswer)
    lastSentDraftRef.current = initialAnswer
  }, [question.id, initialAnswer, isSubmitted])

  useEffect(() => {
    if (isSubmitted || !sendMessage || isSameAnswer(draftAnswer, lastSentDraftRef.current)) {
      return
    }

    const pendingDraft = draftAnswer
    const sendDraft = () => {
      const sent = sendMessage('resonance:update-draft', {
        studentId,
        questionId: question.id,
        answer: pendingDraft,
      })
      if (sent) {
        lastSentDraftRef.current = pendingDraft
      }
    }

    const timeoutId = window.setTimeout(() => {
      sendDraft()
    }, DRAFT_PUSH_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
      if (!isSameAnswer(pendingDraft, lastSentDraftRef.current)) {
        sendDraft()
      }
    }
  }, [draftAnswer, isSubmitted, question.id, sendMessage, studentId])

  async function submitAnswer(answer: { type: 'free-response'; text: string } | { type: 'multiple-choice'; selectedOptionId: string }) {
    if (disabled || isSubmitted) {
      return
    }

    setSubmitting(true)
    setError(null)

    const sentViaWs = sendMessage?.('resonance:submit-answer', {
      studentId,
      questionId: question.id,
      answer,
    }) ?? false

    if (sentViaWs) {
      onSubmitted?.(question.id, answer)
      setDraftAnswer(answer)
      lastSentDraftRef.current = answer
      setSubmitting(false)
      return
    }

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, questionId: question.id, answer }),
      })

      const data = (await resp.json()) as { ok?: boolean; error?: string }

      if (!resp.ok) {
        setError(data.error ?? 'Submission failed — please try again')
        setSubmitting(false)
        return
      }

      onSubmitted?.(question.id, answer)
      setDraftAnswer(answer)
      lastSentDraftRef.current = answer
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-base font-medium text-gray-900">{question.text}</p>

      {question.type === 'free-response' ? (
        <FreeResponseInput
          value={draftAnswer?.type === 'free-response' ? draftAnswer.text : ''}
          onDraftChange={(text) => {
            const trimmed = text.trim()
            setDraftAnswer(trimmed.length > 0 ? { type: 'free-response', text: trimmed } : null)
          }}
          onSubmit={(text) => submitAnswer({ type: 'free-response', text })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      ) : (
        <MCQInput
          options={question.options}
          value={draftAnswer?.type === 'multiple-choice' ? draftAnswer.selectedOptionId : null}
          onDraftChange={(selectedOptionId) => {
            setDraftAnswer(selectedOptionId ? { type: 'multiple-choice', selectedOptionId } : null)
          }}
          onSubmit={(selectedOptionId) => submitAnswer({ type: 'multiple-choice', selectedOptionId })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      )}

      {error !== null && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {disabled && (
        <p className="text-sm text-amber-700" role="status">
          Time is up for this activity.
        </p>
      )}
    </div>
  )
}
