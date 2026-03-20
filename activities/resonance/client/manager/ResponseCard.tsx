import type { InstructorAnnotation, ResponseWithName } from '../../shared/types.js'
import { INSTRUCTOR_ANNOTATION_EMOJIS } from '../../shared/emojiSet.js'

interface Props {
  response: ResponseWithName
  annotation: InstructorAnnotation
  answerText: string
  onAnnotate(patch: Partial<InstructorAnnotation>): void
  onMoveUp?(): void
  onMoveDown?(): void
  selected?: boolean
  onSelectToggle?(): void
}

/**
 * A single instructor-private response card in the free-response review table.
 * Shows the student name, response text, annotation controls, and optional
 * selection checkbox for the share-results flow.
 */
export default function ResponseCard({
  response,
  annotation,
  answerText,
  onAnnotate,
  onMoveUp,
  onMoveDown,
  selected,
  onSelectToggle,
}: Props) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 bg-white ${selected ? 'border-rose-400' : 'border-gray-200'}`}>
      {/* Selection checkbox (share flow) */}
      {onSelectToggle !== undefined && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={onSelectToggle}
          aria-label={`Select response from ${response.studentName}`}
          className="mt-1 accent-rose-600"
        />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-500 truncate">{response.studentName}</p>
        <p className="text-sm text-gray-800 mt-0.5 whitespace-pre-wrap break-words">{answerText}</p>
      </div>

      {/* Annotation controls */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Star */}
        <button
          type="button"
          aria-label={annotation.starred ? 'Unstar response' : 'Star response'}
          aria-pressed={annotation.starred}
          onClick={() => onAnnotate({ starred: !annotation.starred })}
          className={`text-lg leading-none px-1 rounded hover:bg-gray-100 ${annotation.starred ? 'text-yellow-400' : 'text-gray-300'}`}
        >
          ★
        </button>

        {/* Flag */}
        <button
          type="button"
          aria-label={annotation.flagged ? 'Unflag response' : 'Flag response'}
          aria-pressed={annotation.flagged}
          onClick={() => onAnnotate({ flagged: !annotation.flagged })}
          className={`text-sm leading-none px-1 rounded hover:bg-gray-100 ${annotation.flagged ? 'text-red-500' : 'text-gray-300'}`}
        >
          🚩
        </button>

        {/* Emoji picker */}
        <div className="relative group">
          <button
            type="button"
            aria-label="Add emoji annotation"
            aria-haspopup="listbox"
            className="text-sm leading-none px-1 rounded hover:bg-gray-100 text-gray-400"
          >
            {annotation.emoji ?? '☺'}
          </button>
          <ul
            role="listbox"
            aria-label="Choose emoji"
            className="absolute right-0 top-6 z-10 hidden group-focus-within:flex flex-wrap gap-1 w-32 bg-white border border-gray-200 rounded shadow-md p-1"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={annotation.emoji === null}
                onClick={() => onAnnotate({ emoji: null })}
                className="px-1 text-xs text-gray-400 hover:bg-gray-100 rounded"
              >
                none
              </button>
            </li>
            {INSTRUCTOR_ANNOTATION_EMOJIS.map((em) => (
              <li key={em.emoji}>
                <button
                  type="button"
                  role="option"
                  aria-selected={annotation.emoji === em.emoji}
                  onClick={() => onAnnotate({ emoji: em.emoji })}
                  className="text-base hover:bg-gray-100 rounded px-0.5"
                  aria-label={em.label}
                >
                  {em.emoji}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Reorder buttons */}
        {(onMoveUp !== undefined || onMoveDown !== undefined) && (
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="Move response up"
              onClick={onMoveUp}
              disabled={onMoveUp === undefined}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Move response down"
              onClick={onMoveDown}
              disabled={onMoveDown === undefined}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none"
            >
              ▼
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
