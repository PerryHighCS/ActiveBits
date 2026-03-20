import type { QuestionReveal, SharedResponse, StudentQuestion } from '../../shared/types.js'

interface Props {
  reveals: QuestionReveal[]
  revealedQuestions: StudentQuestion[]
}

function getOptionText(question: StudentQuestion | undefined, optionId: string): string {
  if (question?.type !== 'multiple-choice') return optionId
  return question.options.find((o) => o.id === optionId)?.text ?? optionId
}

function ResponseCard({ response, question }: { response: SharedResponse; question: StudentQuestion | undefined }) {
  const { answer, instructorEmoji, reactions } = response

  const answerText =
    answer.type === 'free-response'
      ? answer.text
      : getOptionText(question, answer.selectedOptionId)

  const reactionEntries = Object.entries(reactions).filter(([, count]) => count > 0)

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-1">
      <p className="text-sm text-gray-800">
        {instructorEmoji !== null && (
          <span className="mr-1" aria-label="instructor highlight">
            {instructorEmoji}
          </span>
        )}
        {answerText}
      </p>
      {reactionEntries.length > 0 && (
        <p className="text-xs text-gray-400 flex gap-2">
          {reactionEntries.map(([emoji, count]) => (
            <span key={emoji}>
              {emoji} {count}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function RevealSection({ reveal, question }: { reveal: QuestionReveal; question: StudentQuestion | undefined }) {
  const { sharedResponses, correctOptionIds } = reveal

  // For MCQ poll mode (no correct answer), compute percentages.
  const isPoll =
    question?.type === 'multiple-choice' && (correctOptionIds === null || correctOptionIds.length === 0)

  const mcqCounts: Map<string, number> = new Map()
  if (question?.type === 'multiple-choice') {
    for (const resp of sharedResponses) {
      if (resp.answer.type === 'multiple-choice') {
        const id = resp.answer.selectedOptionId
        mcqCounts.set(id, (mcqCounts.get(id) ?? 0) + 1)
      }
    }
  }

  return (
    <div className="space-y-2">
      {/* Correct-answer reveal for MCQ with a designated answer */}
      {question?.type === 'multiple-choice' && !isPoll && correctOptionIds !== null && correctOptionIds.length > 0 && (
        <p className="text-sm font-medium text-green-700">
          ✓ Correct:{' '}
          {correctOptionIds.map((id) => getOptionText(question, id)).join(', ')}
        </p>
      )}

      {/* Poll: percentage breakdown */}
      {isPoll && question.type === 'multiple-choice' && (
        <div className="space-y-1">
          {question.options.map((opt) => {
            const count = mcqCounts.get(opt.id) ?? 0
            const total = sharedResponses.length
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            return (
              <div key={opt.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate text-gray-700">{opt.text}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 bg-rose-500 rounded-full"
                    style={{ width: `${pct}%` }}
                    role="presentation"
                  />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Shared responses */}
      {sharedResponses.length > 0 && !isPoll && (
        <div className="space-y-2">
          {sharedResponses.map((resp) => (
            <ResponseCard key={resp.id} response={resp} question={question} />
          ))}
        </div>
      )}

      {sharedResponses.length === 0 && !isPoll && (
        <p className="text-sm text-gray-400 italic">No responses shared yet.</p>
      )}
    </div>
  )
}

/**
 * Displays anonymous shared responses and correct-answer reveals from the
 * instructor. Shown to students after the instructor shares results for a
 * question.
 */
export default function SharedResponseFeed({ reveals, revealedQuestions }: Props) {
  if (reveals.length === 0) return null

  // Show the most recent reveal first.
  const sorted = [...reveals].sort((a, b) => b.sharedAt - a.sharedAt)

  return (
    <section aria-label="Shared responses" className="space-y-4">
      {sorted.map((reveal) => {
        const question = revealedQuestions.find((q) => q.id === reveal.questionId)
        return (
          <div key={reveal.questionId} className="space-y-2">
            {question !== undefined && (
              <p className="text-sm font-medium text-gray-700">{question.text}</p>
            )}
            <RevealSection reveal={reveal} question={question} />
          </div>
        )
      })}
    </section>
  )
}
