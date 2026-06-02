import { useState } from 'react'
import { STUDENT_REACTION_EMOJIS } from '../../shared/emojiSet.js'
import { getAnswerSelectedOptionIds, isMcqAnswerCorrect } from '../../shared/mcq.js'
import type { QuestionReveal, ReviewedResponse, SharedResponse, StudentQuestion } from '../../shared/types.js'

interface Props {
  reveals: QuestionReveal[]
  reviewedResponses?: ReviewedResponse[]
  revealedQuestions: StudentQuestion[]
  onReactToSharedResponse?: (questionId: string, sharedResponseId: string, emoji: string) => void
}

function orderRevealsByQuestionSequence(
  reveals: QuestionReveal[],
  revealedQuestions: StudentQuestion[],
): QuestionReveal[] {
  const questionOrder = new Map(
    revealedQuestions.map((question, index) => [question.id, index] satisfies [string, number]),
  )

  return reveals
    .map((reveal, index) => ({
      reveal,
      index,
      order: questionOrder.get(reveal.questionId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.reveal)
}

function getOptionText(question: StudentQuestion | undefined, optionId: string): string {
  if (question?.type !== 'multiple-choice') return optionId
  return question.options.find((o) => o.id === optionId)?.text ?? optionId
}

function getOptionTextList(question: StudentQuestion | undefined, optionIds: string[]): string {
  return optionIds.map((optionId) => getOptionText(question, optionId)).join(', ')
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
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
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
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-600'
            }`}
          >
            {viewerReaction ?? '☺'}
          </button>
          {isPickerOpen && (
            <ul
              role="listbox"
              aria-label="Choose reaction emoji"
              className="absolute left-0 top-full z-10 mt-1 flex w-40 flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-lg"
            >
              {STUDENT_REACTION_EMOJIS.map((entry) => (
                <li key={entry.emoji}>
                  <button
                    type="button"
                    role="option"
                    aria-label={`React with ${entry.label}`}
                    aria-selected={viewerReaction === entry.emoji}
                    className={`rounded-lg px-1.5 py-1 text-base hover:bg-slate-100 dark:hover:bg-slate-700 ${
                      viewerReaction === entry.emoji
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : ''
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
            viewerReaction === emoji
              ? 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
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
      : getOptionTextList(question, answer.selectedOptionIds)

  const canReact = question?.type === 'free-response' && onReactToSharedResponse !== undefined
  const viewerReaction = response.viewerReaction ?? null

  return (
    <div
      className={`rounded-xl border px-4 py-3 space-y-2 ${
        response.isOwnResponse
          ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/20'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
      }`}
    >
      {response.isOwnResponse && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          Your response was shared
        </p>
      )}
      <p className="text-sm text-slate-800 dark:text-slate-200">
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
        onReact={
          canReact
            ? (emoji) => {
                onReactToSharedResponse?.(response.questionId, response.id, emoji)
              }
            : undefined
        }
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

  const isPoll =
    question?.type === 'multiple-choice' && (correctOptionIds === null || correctOptionIds.length === 0)

  const mcqCounts: Map<string, number> = new Map()
  if (question?.type === 'multiple-choice') {
    for (const resp of sharedResponses) {
      if (resp.answer.type === 'multiple-choice') {
        for (const optionId of resp.answer.selectedOptionIds) {
          mcqCounts.set(optionId, (mcqCounts.get(optionId) ?? 0) + 1)
        }
      }
    }
  }

  const viewerIsCorrect =
    question?.type === 'multiple-choice' &&
    !isPoll &&
    viewerResponse?.answer.type === 'multiple-choice' &&
    correctOptionIds !== null
      ? isMcqAnswerCorrect(getAnswerSelectedOptionIds(viewerResponse.answer), correctOptionIds)
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
          className={`rounded-xl border px-4 py-3 space-y-1 ${
            viewerIsCorrect === true
              ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
              : viewerIsCorrect === false
                ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                : viewerResponse.isShared
                  ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-indigo-200 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/10'
          }`}
        >
          <p
            className={`text-[11px] font-semibold uppercase tracking-wide ${
              viewerIsCorrect === true
                ? 'text-emerald-700 dark:text-emerald-400'
                : viewerIsCorrect === false
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-indigo-700 dark:text-indigo-400'
            }`}
          >
            {question?.type === 'multiple-choice' && viewerIsCorrect !== null
              ? `Your response: ${viewerIsCorrect ? 'Correct' : 'Incorrect'}`
              : 'Your response'}
          </p>
          <p className="text-sm text-slate-800 dark:text-slate-200">
            {viewerResponse.instructorEmoji !== null && (
              <span className="mr-1" aria-label="instructor highlight">
                {viewerResponse.instructorEmoji}
              </span>
            )}
            {viewerResponse.answer.type === 'free-response'
              ? viewerResponse.answer.text
              : getOptionTextList(question, viewerResponse.answer.selectedOptionIds)}
          </p>
          {viewerResponse.isShared && question?.type === 'free-response' && (
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              This is the response currently being shared.
            </p>
          )}
        </div>
      )}

      {shouldRenderMcqBreakdown && question.type === 'multiple-choice' && (
        <div className="space-y-1.5">
          {question.options.map((opt) => {
            const count = mcqCounts.get(opt.id) ?? 0
            const total = sharedResponses.length
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            const isViewerSelection =
              viewerResponse?.answer.type === 'multiple-choice' &&
              viewerResponse.answer.selectedOptionIds.includes(opt.id)
            const isCorrectOption = correctOptionIds?.includes(opt.id) ?? false
            const baseRowClass = isPoll
              ? isViewerSelection
                ? 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
              : isCorrectOption
                ? 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                : 'border-red-200 dark:border-red-800 bg-red-50/70 dark:bg-red-900/10'
            const rowClass =
              `${baseRowClass} ${isViewerSelection ? 'ring-2 ring-indigo-400 dark:ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`.trim()
            const meterClass = isPoll
              ? 'bg-indigo-500'
              : isCorrectOption
                ? 'bg-emerald-500'
                : 'bg-red-400'
            return (
              <div
                key={opt.id}
                data-option-id={opt.id}
                className={`${
                  isViewerOnlyMcqReveal
                    ? 'flex items-center justify-between gap-3'
                    : 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2'
                } rounded-xl border px-3 py-2.5 text-sm ${rowClass}`}
              >
                <span className="text-slate-700 dark:text-slate-300 break-words">{opt.text}</span>
                {isViewerOnlyMcqReveal ? (
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                      isCorrectOption
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
                        : isViewerSelection
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {isCorrectOption ? 'Correct' : isViewerSelection ? 'Your choice' : 'Other option'}
                  </span>
                ) : (
                  <>
                    <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-2.5 rounded-full transition-all ${meterClass}`}
                        style={{ width: `${pct}%` }}
                        role="presentation"
                      />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 w-8 text-right tabular-nums">
                      {pct}%
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

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
        <p className="text-sm text-slate-400 dark:text-slate-500 italic">No responses shared yet.</p>
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
          <div
            key={`${response.question.id}:${response.submittedAt}`}
            className="rounded-xl border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3 space-y-1"
          >
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {response.question.text}
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <span className="mr-1" aria-label="instructor highlight">
                {response.instructorEmoji}
              </span>
              {response.answer.type === 'free-response'
                ? response.answer.text
                : getOptionTextList(response.question, response.answer.selectedOptionIds)}
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

  const orderedReveals = orderRevealsByQuestionSequence(reveals, revealedQuestions)

  return (
    <div className="space-y-6">
      <ReviewedResponseSection reviewedResponses={reviewedResponses} />
      {orderedReveals.length > 0 && (
        <section aria-label="Shared responses" className="space-y-5">
          {orderedReveals.map((reveal) => {
            const question = revealedQuestions.find((q) => q.id === reveal.questionId)
            return (
              <div key={reveal.questionId} className="space-y-2.5">
                {question !== undefined && (
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {question.text}
                  </p>
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
