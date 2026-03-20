import type {
  InstructorAnnotation,
  MCQQuestion,
  Question,
  ResponseWithName,
} from '../../shared/types.js'
import ResponseCard from './ResponseCard.js'

interface Props {
  question: Question
  responses: ResponseWithName[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  shareMode: boolean
  selectedIds: Set<string>
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onReorder(newOrder: string[]): void
  onSelectToggle(responseId: string): void
}

// ---------------------------------------------------------------------------
// MCQ table view
// ---------------------------------------------------------------------------

function MCQTable({
  question,
  responses,
  annotations,
  shareMode,
  selectedIds,
  onAnnotate,
  onSelectToggle,
}: {
  question: MCQQuestion
  responses: ResponseWithName[]
  annotations: Record<string, InstructorAnnotation>
  shareMode: boolean
  selectedIds: Set<string>
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onSelectToggle(responseId: string): void
}) {
  const options = question.options

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            {shareMode && <th className="pr-2 py-1 w-6" aria-label="Select" />}
            <th className="pr-4 py-1 font-medium">Student</th>
            {options.map((opt) => (
              <th
                key={opt.id}
                className={`px-2 py-1 font-medium text-center ${opt.isCorrect ? 'text-green-700' : ''}`}
              >
                {opt.text}
                {opt.isCorrect && <span className="ml-1 text-green-600">✓</span>}
              </th>
            ))}
            <th className="pl-2 py-1 font-medium w-16">Emoji</th>
          </tr>
        </thead>
        <tbody>
          {responses.map((resp) => {
            const selectedOptionId =
              resp.answer.type === 'multiple-choice' ? resp.answer.selectedOptionId : null
            const annotation = annotations[resp.id] ?? { starred: false, flagged: false, emoji: null }
            const selectedOption = options.find((o) => o.id === selectedOptionId)
            const isCorrect = selectedOption?.isCorrect === true
            const isIncorrect = selectedOptionId !== null && selectedOption?.isCorrect === false && options.some((o) => o.isCorrect)

            return (
              <tr
                key={resp.id}
                className={`border-b border-gray-100 hover:bg-gray-50 ${selectedIds.has(resp.id) ? 'bg-rose-50' : ''}`}
              >
                {shareMode && (
                  <td className="pr-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(resp.id)}
                      onChange={() => onSelectToggle(resp.id)}
                      aria-label={`Select ${resp.studentName}`}
                      className="accent-rose-600"
                    />
                  </td>
                )}
                <td className="pr-4 py-1.5 font-medium text-gray-700 max-w-[120px] truncate">
                  <span title={resp.studentName}>{resp.studentName}</span>
                  {annotation.starred && <span className="ml-1 text-yellow-400">★</span>}
                  {annotation.flagged && <span className="ml-1 text-red-500">🚩</span>}
                </td>
                {options.map((opt) => {
                  const chosen = opt.id === selectedOptionId
                  return (
                    <td key={opt.id} className="px-2 py-1.5 text-center">
                      {chosen && (
                        <span
                          className={`inline-block w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
                            isCorrect
                              ? 'bg-green-100 text-green-700'
                              : isIncorrect
                                ? 'bg-red-100 text-red-600'
                                : 'bg-gray-100 text-gray-600'
                          }`}
                          aria-label={`Selected${isCorrect ? ', correct' : isIncorrect ? ', incorrect' : ''}`}
                        >
                          •
                        </span>
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
                      onClick={() => onAnnotate(resp.id, {})}
                      className="text-base hover:bg-gray-100 rounded px-0.5"
                    >
                      {annotation.emoji ?? '—'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {responses.length === 0 && (
            <tr>
              <td
                colSpan={options.length + (shareMode ? 3 : 2)}
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
  annotations,
  orderOverrides,
  shareMode,
  selectedIds,
  onAnnotate,
  onReorder,
  onSelectToggle,
}: {
  responses: ResponseWithName[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  shareMode: boolean
  selectedIds: Set<string>
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onReorder(newOrder: string[]): void
  onSelectToggle(responseId: string): void
}) {
  // Apply order overrides: put overridden IDs first in the given order, then any remaining.
  const overrideSet = new Set(orderOverrides)
  const ordered = [
    ...orderOverrides.map((id) => responses.find((r) => r.id === id)).filter(Boolean),
    ...responses.filter((r) => !overrideSet.has(r.id)),
  ] as ResponseWithName[]

  function moveItem(fromIndex: number, toIndex: number) {
    const ids = ordered.map((r) => r.id)
    const [moved] = ids.splice(fromIndex, 1)
    ids.splice(toIndex, 0, moved)
    onReorder(ids)
  }

  return (
    <div className="space-y-2">
      {ordered.map((resp, idx) => {
        const annotation = annotations[resp.id] ?? { starred: false, flagged: false, emoji: null }
        const answerText = resp.answer.type === 'free-response' ? resp.answer.text : ''
        return (
          <ResponseCard
            key={resp.id}
            response={resp}
            annotation={annotation}
            answerText={answerText}
            onAnnotate={(patch) => onAnnotate(resp.id, patch)}
            onMoveUp={idx > 0 ? () => moveItem(idx, idx - 1) : undefined}
            onMoveDown={idx < ordered.length - 1 ? () => moveItem(idx, idx + 1) : undefined}
            selected={shareMode ? selectedIds.has(resp.id) : undefined}
            onSelectToggle={shareMode ? () => onSelectToggle(resp.id) : undefined}
          />
        )
      })}
      {ordered.length === 0 && (
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
  annotations,
  orderOverrides,
  shareMode,
  selectedIds,
  onAnnotate,
  onReorder,
  onSelectToggle,
}: Props) {
  if (question.type === 'multiple-choice') {
    return (
      <MCQTable
        question={question}
        responses={responses}
        annotations={annotations}
        shareMode={shareMode}
        selectedIds={selectedIds}
        onAnnotate={onAnnotate}
        onSelectToggle={onSelectToggle}
      />
    )
  }

  return (
    <FreeResponseList
      responses={responses}
      annotations={annotations}
      orderOverrides={orderOverrides}
      shareMode={shareMode}
      selectedIds={selectedIds}
      onAnnotate={onAnnotate}
      onReorder={onReorder}
      onSelectToggle={onSelectToggle}
    />
  )
}
