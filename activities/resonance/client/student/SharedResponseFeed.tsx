import { useState } from 'react'
import { STUDENT_REACTION_EMOJIS } from '../../shared/emojiSet.js'
import type { QuestionReveal, ReviewedResponse, SharedResponse, StudentQuestion } from '../../shared/types.js'

interface Props {
  reveals: QuestionReveal[]
  reviewedResponses?: ReviewedResponse[]
  revealedQuestions: StudentQuestion[]
  onReactToSharedResponse?: (questionId: string, sharedResponseId: string, emoji: string) => void
}

function getOptionText(question: StudentQuestion | undefined, optionId: string): string {
  if (question?.type !== 'multiple-choice') return optionId
  return question.options.find((o) => o.id === optionId)?.text ?? optionId
}

function ReactionSummary({
  reactions,
  viewerReaction,
  canReact,
  onReact,
}: {
  reactions: Record<string, number>
  viewerReaction: string | null
  canReact: boolean
  onReact?: (emoji: string) => void
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const reactionEntries = Object.entries(reactions).filter(([, count]) => count > 0)

  if (!canReact && reactionEntries.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
      {canReact && onReact !== undefined && (
        <div className="relative">
          <button
            type="button"
            aria-label="Choose reaction"
            aria-haspopup="listbox"
            aria-expanded={isPickerOpen}
            onClick={() => setIsPickerOpen((current) => !current)}
            className={`rounded-full border px-2 py-1 text-sm transition ${
              viewerReaction !== null
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100'
            }`}
          >
            {viewerReaction ?? '☺'}
          </button>
          {isPickerOpen && (
            <ul
              role="listbox"
              aria-label="Choose reaction emoji"
              className="absolute left-0 top-full z-10 mt-1 flex w-40 flex-wrap gap-1 rounded border border-gray-200 bg-white p-1 shadow-md"
            >
              {STUDENT_REACTION_EMOJIS.map((entry) => (
                <li key={entry.emoji}>
                  <button
                    type="button"
                    role="option"
                    aria-label={`React with ${entry.label}`}
                    aria-selected={viewerReaction === entry.emoji}
                    className={`rounded px-1.5 py-1 text-base hover:bg-gray-100 ${
                      viewerReaction === entry.emoji ? 'bg-blue-50 text-blue-700' : ''
                    }`}
                    onClick={() => {
                      onReact(entry.emoji)
                      setIsPickerOpen(false)
                    }}
                  >
                    {entry.emoji}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {reactionEntries.map(([emoji, count]) => (
        <span
          key={emoji}
          className={`inline-flex items-center rounded-full border px-2 py-1 ${
            viewerReaction === emoji ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50'
          }`}
        >
          {emoji} {count}
        </span>
      ))}
    </div>
  )
}

function ResponseCard({
  response,
  question,
  onReactToSharedResponse,
}: {
  response: SharedResponse
  question: StudentQuestion | undefined
  onReactToSharedResponse?: (questionId: string, sharedResponseId: string, emoji: string) => void
}) {
  const { answer, instructorEmoji, reactions } = response

  const answerText =
    answer.type === 'free-response'
      ? answer.text
      : getOptionText(question, answer.selectedOptionId)

  const canReact = question?.type === 'free-response' && onReactToSharedResponse !== undefined
  const viewerReaction = response.viewerReaction ?? null

  return (
    <div className={`rounded-lg border bg-white px-4 py-3 space-y-2 ${response.isOwnResponse ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`}>
      {response.isOwnResponse && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Your response was shared
        </p>
      )}
      <p className="text-sm text-gray-800">
        {instructorEmoji !== null && (
          <span className="mr-1" aria-label="instructor highlight">
            {instructorEmoji}
          </span>
        )}
        {answerText}
      </p>
      <ReactionSummary
        reactions={reactions}
        viewerReaction={viewerReaction}
        canReact={canReact}
        onReact={canReact
          ? (emoji) => {
              onReactToSharedResponse?.(response.questionId, response.id, emoji)
            }
          : undefined}
      />
    </div>
  )
}

function RevealSection({
  reveal,
  question,
  onReactToSharedResponse,
}: {
  reveal: QuestionReveal
  question: StudentQuestion | undefined
  onReactToSharedResponse?: (questionId: string, sharedResponseId: string, emoji: string) => void
}) {
  const { sharedResponses, correctOptionIds, viewerResponse } = reveal

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

  const viewerIsCorrect =
    question?.type === 'multiple-choice' &&
    !isPoll &&
    viewerResponse?.answer.type === 'multiple-choice' &&
    correctOptionIds !== null
      ? correctOptionIds.includes(viewerResponse.answer.selectedOptionId)
      : null

  const shouldRenderMcqBreakdown = question?.type === 'multiple-choice'
  const isViewerOnlyMcqReveal =
    question?.type === 'multiple-choice' &&
    !isPoll &&
    sharedResponses.length === 0 &&
    viewerResponse !== null &&
    viewerResponse !== undefined

  return (
    <div className="space-y-2">
      {viewerResponse !== null && viewerResponse !== undefined && (
        <div
          className={`rounded-lg border px-4 py-3 space-y-1 ${
            viewerIsCorrect === true
              ? 'border-green-300 bg-green-50'
              : viewerIsCorrect === false
                ? 'border-red-300 bg-red-50'
                : viewerResponse.isShared
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-sky-200 bg-sky-50'
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            {question?.type === 'multiple-choice' && viewerIsCorrect !== null
              ? `Your response: ${viewerIsCorrect ? 'Correct' : 'Incorrect'}`
              : 'Your response'}
          </p>
          <p className="text-sm text-sky-950">
            {viewerResponse.instructorEmoji !== null && (
              <span className="mr-1" aria-label="instructor highlight">
                {viewerResponse.instructorEmoji}
              </span>
            )}
            {viewerResponse.answer.type === 'free-response'
              ? viewerResponse.answer.text
              : getOptionText(question, viewerResponse.answer.selectedOptionId)}
          </p>
          {viewerResponse.isShared && question?.type === 'free-response' && (
            <p className="text-xs text-sky-700">This is the response currently being shared.</p>
          )}
        </div>
      )}

      {shouldRenderMcqBreakdown && question.type === 'multiple-choice' && (
        <div className="space-y-1">
          {question.options.map((opt) => {
            const count = mcqCounts.get(opt.id) ?? 0
            const total = sharedResponses.length
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            const isViewerSelection =
              viewerResponse?.answer.type === 'multiple-choice' &&
              viewerResponse.answer.selectedOptionId === opt.id
            const isCorrectOption = correctOptionIds?.includes(opt.id) ?? false
            const baseRowClass = isPoll
              ? isViewerSelection
                ? 'border-blue-300 bg-blue-50'
                : 'border-transparent'
              : isCorrectOption
                ? 'border-green-300 bg-green-50'
                : 'border-red-200 bg-red-50/70'
            const rowClass = `${baseRowClass} ${isViewerSelection ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-white' : ''}`.trim()
            const meterClass = isPoll ? 'bg-blue-500' : isCorrectOption ? 'bg-green-500' : 'bg-red-400'
            return (
              <div
                key={opt.id}
                className={`${
                  isViewerOnlyMcqReveal
                    ? 'flex items-center justify-between gap-3'
                    : 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2'
                } rounded-lg border px-3 py-2 text-sm ${rowClass}`}
              >
                <span className="text-gray-700 break-words">{opt.text}</span>
                {isViewerOnlyMcqReveal ? (
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                    isCorrectOption
                      ? 'bg-green-100 text-green-800'
                      : isViewerSelection
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isCorrectOption ? 'Correct' : isViewerSelection ? 'Your choice' : 'Other option'}
                  </span>
                ) : (
                  <>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${meterClass}`}
                        style={{ width: `${pct}%` }}
                        role="presentation"
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Shared responses */}
      {sharedResponses.length > 0 && question?.type !== 'multiple-choice' && (
        <div className="space-y-2">
          {sharedResponses.map((resp) => (
            <ResponseCard
              key={resp.id}
              response={resp}
              question={question}
              onReactToSharedResponse={onReactToSharedResponse}
            />
          ))}
        </div>
      )}

      {sharedResponses.length === 0 && question?.type !== 'multiple-choice' && (
        <p className="text-sm text-gray-400 italic">No responses shared yet.</p>
      )}
    </div>
  )
}

function ReviewedResponseSection({ reviewedResponses }: { reviewedResponses: ReviewedResponse[] }) {
  if (reviewedResponses.length === 0) {
    return null
  }

  return (
    <section aria-label="Instructor feedback" className="space-y-3">
      <div className="space-y-3">
        {reviewedResponses.map((response) => (
          <div key={`${response.question.id}:${response.submittedAt}`} className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 space-y-1">
            <p className="text-sm font-medium text-sky-900">{response.question.text}</p>
            <p className="text-sm text-sky-950">
              <span className="mr-1" aria-label="instructor highlight">
                {response.instructorEmoji}
              </span>
              {response.answer.type === 'free-response'
                ? response.answer.text
                : getOptionText(response.question, response.answer.selectedOptionId)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Displays anonymous shared responses and correct-answer reveals from the
 * instructor. Shown to students after the instructor shares results for a
 * question.
 */
export default function SharedResponseFeed({
  reveals,
  reviewedResponses = [],
  revealedQuestions,
  onReactToSharedResponse,
}: Props) {
  if (reveals.length === 0 && reviewedResponses.length === 0) return null

  // Show the most recent reveal first.
  const sorted = [...reveals].sort((a, b) => b.sharedAt - a.sharedAt)

  return (
    <div className="space-y-6">
      <ReviewedResponseSection reviewedResponses={reviewedResponses} />
      {sorted.length > 0 && (
        <section aria-label="Shared responses" className="space-y-4">
          {sorted.map((reveal) => {
            const question = revealedQuestions.find((q) => q.id === reveal.questionId)
            return (
              <div key={reveal.questionId} className="space-y-2">
                {question !== undefined && (
                  <p className="text-sm font-medium text-gray-700">{question.text}</p>
                )}
                <RevealSection
                  reveal={reveal}
                  question={question}
                  onReactToSharedResponse={onReactToSharedResponse}
                />
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
