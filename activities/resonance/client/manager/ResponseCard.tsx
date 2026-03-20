import type { InstructorAnnotation, ResponseProgressStatus, ResponseWithName } from '../../shared/types.js'
import { INSTRUCTOR_ANNOTATION_EMOJIS } from '../../shared/emojiSet.js'

interface Props {
  response: ResponseWithName
  annotation: InstructorAnnotation
  answerText: string
  status?: ResponseProgressStatus
  onAnnotate(patch: Partial<InstructorAnnotation>): void
  onShare?(): void
  shareLabel?: string
  shareActive?: boolean
  onMoveUp?(): void
  onMoveDown?(): void
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
  status = 'submitted',
  onAnnotate,
  onShare,
  shareLabel = 'Share',
  shareActive = false,
  onMoveUp,
  onMoveDown,
}: Props) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
        shareActive ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex flex-col items-center gap-2 shrink-0 pt-0.5">
        <button
          type="button"
          aria-label={annotation.starred ? 'Unstar response' : 'Star response'}
          aria-pressed={annotation.starred}
          onClick={() => onAnnotate({ starred: !annotation.starred })}
          disabled={status !== 'submitted'}
          className={`rounded-md px-1.5 py-1 text-lg leading-none ${
            annotation.starred
              ? 'bg-yellow-100 text-yellow-500'
              : 'text-gray-300 hover:bg-gray-100'
          } disabled:opacity-50`}
        >
          ★
        </button>

        <button
          type="button"
          aria-label={annotation.flagged ? 'Unflag response' : 'Flag response'}
          aria-pressed={annotation.flagged}
          onClick={() => onAnnotate({ flagged: !annotation.flagged })}
          disabled={status !== 'submitted'}
          className={`rounded-md px-1.5 py-1 text-sm leading-none ${
            annotation.flagged
              ? 'bg-red-100 text-red-600 ring-1 ring-red-200'
              : 'text-gray-300 hover:bg-gray-100'
          } disabled:opacity-50`}
        >
          🚩
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-gray-500 truncate">{response.studentName}</p>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              status === 'submitted'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {status === 'submitted' ? 'Submitted' : 'Still working'}
          </span>
        </div>
        <p className="text-sm text-gray-800 mt-0.5 whitespace-pre-wrap break-words">{answerText}</p>
      </div>

      {/* Annotation controls */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Emoji picker */}
        <div className="relative group">
          <button
            type="button"
            aria-label="Add emoji annotation"
            aria-haspopup="listbox"
            disabled={status !== 'submitted'}
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

        {onShare !== undefined && (
          <button
            type="button"
            aria-label={`${shareLabel} response from ${response.studentName}`}
            onClick={onShare}
            disabled={status !== 'submitted'}
            className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
              shareActive
                ? 'border-rose-400 bg-rose-100 text-rose-800'
                : 'border-rose-300 text-rose-700 hover:bg-rose-50'
            }`}
          >
            {shareLabel}
          </button>
        )}

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
