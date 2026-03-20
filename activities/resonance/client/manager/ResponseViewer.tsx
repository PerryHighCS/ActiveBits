import type {
  InstructorAnnotation,
  MCQQuestion,
  Question,
  ResponseProgress,
  ResponseWithName,
} from '../../shared/types.js'
import ResponseCard from './ResponseCard.js'

interface Props {
  question: Question
  responses: ResponseWithName[]
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  activeSharedResponseId?: string | null
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onShareResponse?(responseId: string): void
  onReorder(newOrder: string[]): void
}

// ---------------------------------------------------------------------------
// MCQ table view
// ---------------------------------------------------------------------------

function MCQTable({
  question,
  progress,
  annotations,
  onAnnotate,
}: {
  question: MCQQuestion
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
}) {
  const options = question.options
  const isPoll = !options.some((option) => option.isCorrect)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="pr-4 py-1 font-medium">Student</th>
            {options.map((opt) => (
              <th
                key={opt.id}
                className={`min-w-[120px] px-3 py-2 font-medium text-center ${opt.isCorrect ? 'text-green-700' : ''}`}
              >
                {opt.text}
                {opt.isCorrect && <span className="ml-1 text-green-600">✓</span>}
              </th>
            ))}
            <th className="pl-2 py-1 font-medium w-16">Emoji</th>
          </tr>
        </thead>
        <tbody>
          {progress.map((entry) => {
            const responseId = entry.responseId
            const selectedOptionId =
              entry.answer?.type === 'multiple-choice' ? entry.answer.selectedOptionId : null
            const annotation = responseId
              ? (annotations[responseId] ?? { starred: false, flagged: false, emoji: null })
              : { starred: false, flagged: false, emoji: null }
            const selectedOption = options.find((o) => o.id === selectedOptionId)
            const isCorrect = selectedOption?.isCorrect === true
            const isIncorrect = selectedOptionId !== null && selectedOption?.isCorrect === false && options.some((o) => o.isCorrect)

            return (
              <tr
                key={`${entry.studentId}:${entry.questionId}`}
                className="border-b border-gray-100 hover:bg-gray-50"
              >
                <td className="pr-4 py-1.5 font-medium text-gray-700 max-w-[120px] truncate">
                  <span title={entry.studentName}>{entry.studentName}</span>
                  <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    entry.status === 'submitted'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {entry.status === 'submitted' ? 'Submitted' : 'Still working'}
                  </span>
                  {annotation.starred && <span className="ml-1 text-yellow-400">★</span>}
                  {annotation.flagged && <span className="ml-1 text-red-500">🚩</span>}
                </td>
                {options.map((opt) => {
                  const chosen = opt.id === selectedOptionId
                  return (
                    <td
                      key={opt.id}
                      className={`px-3 py-2 text-center align-middle ${
                        chosen
                          ? isPoll
                            ? 'bg-sky-50'
                            : isCorrect
                            ? 'bg-green-50'
                            : isIncorrect
                              ? 'bg-red-50'
                              : 'bg-rose-50'
                          : ''
                      }`}
                    >
                      {chosen && (
                        <div className="flex justify-center">
                          <span
                            className={`inline-block h-5 w-5 rounded-full ${
                              isPoll
                                ? 'bg-sky-500'
                                : isCorrect
                                ? 'bg-green-600'
                                : isIncorrect
                                  ? 'bg-red-500'
                                  : 'bg-rose-500'
                            }`}
                            aria-label={`Selected${isCorrect ? ', correct' : isIncorrect ? ', incorrect' : ''}`}
                          />
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="pl-2 py-1.5">
                  <div className="relative group inline-block">
                    <button
                      type="button"
                      aria-label="Emoji annotation"
                      aria-haspopup="listbox"
                      onClick={() => {
                        if (responseId) {
                          onAnnotate(responseId, {})
                        }
                      }}
                      disabled={!responseId}
                      className="text-base hover:bg-gray-100 rounded px-0.5"
                    >
                      {annotation.emoji ?? '—'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {progress.length === 0 && (
            <tr>
              <td
                colSpan={options.length + 2}
                className="py-4 text-center text-sm text-gray-400"
              >
                No responses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Free-response list with reordering
// ---------------------------------------------------------------------------

function FreeResponseList({
  responses,
  progress,
  annotations,
  orderOverrides,
  activeSharedResponseId,
  onAnnotate,
  onShareResponse,
  onReorder,
}: {
  responses: ResponseWithName[]
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  activeSharedResponseId?: string | null
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onShareResponse?(responseId: string): void
  onReorder(newOrder: string[]): void
}) {
  // Apply order overrides: put overridden IDs first in the given order, then any remaining.
  const overrideSet = new Set(orderOverrides)
  const progressByResponseId = new Map(progress.filter((entry) => entry.responseId).map((entry) => [entry.responseId as string, entry]))
  const ordered = [
    ...orderOverrides.map((id) => responses.find((r) => r.id === id)).filter(Boolean),
    ...responses.filter((r) => !overrideSet.has(r.id)),
  ] as ResponseWithName[]
  const workingOnly = progress
    .filter((entry) => entry.status === 'working' && !entry.responseId)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  function moveItem(fromIndex: number, toIndex: number) {
    const ids = ordered.map((r) => r.id)
    const moved = ids.splice(fromIndex, 1)[0]
    if (moved !== undefined) ids.splice(toIndex, 0, moved)
    onReorder(ids)
  }

  return (
    <div className="space-y-2">
      {ordered.map((resp, idx) => {
        const annotation = annotations[resp.id] ?? { starred: false, flagged: false, emoji: null }
        const answerText = resp.answer.type === 'free-response' ? resp.answer.text : ''
        const status = progressByResponseId.get(resp.id)?.status ?? 'submitted'
        return (
          <ResponseCard
            key={resp.id}
            response={resp}
            annotation={annotation}
            answerText={answerText}
            status={status}
            onAnnotate={(patch) => onAnnotate(resp.id, patch)}
            onShare={onShareResponse ? () => onShareResponse(resp.id) : undefined}
            shareLabel={activeSharedResponseId === resp.id ? 'Stop sharing' : 'Share'}
            shareActive={activeSharedResponseId === resp.id}
            onMoveUp={idx > 0 ? () => moveItem(idx, idx - 1) : undefined}
            onMoveDown={idx < ordered.length - 1 ? () => moveItem(idx, idx + 1) : undefined}
          />
        )
      })}
      {workingOnly.map((entry) => (
        <ResponseCard
          key={`${entry.studentId}:${entry.questionId}`}
          response={{
            id: `draft:${entry.studentId}:${entry.questionId}`,
            questionId: entry.questionId,
            studentId: entry.studentId,
            submittedAt: entry.updatedAt,
            answer: entry.answer ?? { type: 'free-response', text: '' },
            studentName: entry.studentName,
          }}
          annotation={{ starred: false, flagged: false, emoji: null }}
          answerText={entry.answer?.type === 'free-response' ? entry.answer.text : 'Working on a response…'}
          status="working"
          onAnnotate={() => {}}
        />
      ))}
      {ordered.length === 0 && workingOnly.length === 0 && (
        <p className="text-sm text-gray-400 italic">No responses yet.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ResponseViewer
// ---------------------------------------------------------------------------

/**
 * Renders the appropriate response review UI based on question type:
 * - Multiple-choice: table with name | option columns, correct/incorrect styling
 * - Free-response: reorderable list with star/flag/emoji annotation controls
 */
export default function ResponseViewer({
  question,
  responses,
  progress,
  annotations,
  orderOverrides,
  activeSharedResponseId,
  onAnnotate,
  onShareResponse,
  onReorder,
}: Props) {
  if (question.type === 'multiple-choice') {
    return (
      <MCQTable
        question={question}
        progress={progress}
        annotations={annotations}
        onAnnotate={onAnnotate}
      />
    )
  }

  return (
    <FreeResponseList
      responses={responses}
      progress={progress}
      annotations={annotations}
      orderOverrides={orderOverrides}
      activeSharedResponseId={activeSharedResponseId}
      onAnnotate={onAnnotate}
      onShareResponse={onShareResponse}
      onReorder={onReorder}
    />
  )
}
