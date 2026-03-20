import { useState } from 'react'
import type { StudentQuestion } from '../../shared/types.js'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'

interface Props {
  question: StudentQuestion
  sessionId: string
  studentId: string
}

/**
 * Renders the active question and the appropriate answer input.
 * Submission goes to POST /api/resonance/:sessionId/submit-answer.
 * Phase 7 will add a WebSocket path alongside this REST fallback.
 */
export default function QuestionView({ question, sessionId, studentId }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitAnswer(answer: { type: 'free-response'; text: string } | { type: 'multiple-choice'; selectedOptionId: string }) {
    setSubmitting(true)
    setError(null)

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, answer }),
      })

      const data = (await resp.json()) as { ok?: boolean; error?: string }

      if (!resp.ok) {
        setError(data.error ?? 'Submission failed — please try again')
        setSubmitting(false)
        return
      }

      setSubmitted(true)
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
          onSubmit={(text) => submitAnswer({ type: 'free-response', text })}
          submitting={submitting}
          submitted={submitted}
        />
      ) : (
        <MCQInput
          options={question.options}
          onSubmit={(selectedOptionId) => submitAnswer({ type: 'multiple-choice', selectedOptionId })}
          submitting={submitting}
          submitted={submitted}
        />
      )}

      {error !== null && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
