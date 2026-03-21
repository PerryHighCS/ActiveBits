import type { Question } from '../../shared/types.js'

interface Props {
  question: Question
  index: number
  onRemove(): void
  onEdit(): void
  onMoveUp?(): void
  onMoveDown?(): void
}

const TYPE_LABEL: Record<string, string> = {
  'free-response': 'Free response',
  'multiple-choice': 'Multiple choice',
}

/**
 * Compact card for a single question in the builder list.
 */
export default function QuestionCard({ question, index, onRemove, onEdit, onMoveUp, onMoveDown }: Props) {
  const correctOptions =
    question.type === 'multiple-choice' ? question.options.filter((o) => o.isCorrect) : []
  const isPoll = question.type === 'multiple-choice' && correctOptions.length === 0

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      {/* Index */}
      <span className="text-xs font-mono text-gray-400 mt-0.5 w-5 shrink-0">{index + 1}.</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate" title={question.text}>
          {question.text}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-400">{TYPE_LABEL[question.type]}</span>
          {isPoll && <span className="text-xs text-blue-500">poll</span>}
          {correctOptions.length > 0 && (
            <span className="text-xs text-green-600">✓ {correctOptions[0]?.text}</span>
          )}
          {question.responseTimeLimitMs !== undefined && question.responseTimeLimitMs !== null && (
            <span className="text-xs text-amber-600">⏱ {question.responseTimeLimitMs / 1000}s</span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Move question ${index + 1} up`}
            onClick={onMoveUp}
            disabled={onMoveUp === undefined}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`Move question ${index + 1} down`}
            onClick={onMoveDown}
            disabled={onMoveDown === undefined}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none"
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          aria-label={`Edit question ${index + 1}`}
          onClick={onEdit}
          className="text-xs text-gray-500 hover:text-gray-800 px-1"
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`Remove question ${index + 1}`}
          onClick={onRemove}
          className="text-xs text-red-400 hover:text-red-600 px-1"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
