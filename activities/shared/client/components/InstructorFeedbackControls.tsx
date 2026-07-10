import { type ReactElement } from 'react'

export interface InstructorFeedbackAnnotation {
  starred: boolean
  flagged: boolean
  emoji: string | null
}

export interface InstructorFeedbackEmojiOption {
  emoji: string
  label: string
}

interface InstructorFeedbackControlsProps {
  annotation: InstructorFeedbackAnnotation
  emojiOptions?: readonly InstructorFeedbackEmojiOption[]
  disabled?: boolean
  flagMode?: 'toggle' | 'add'
  onToggleStar?: (starred: boolean) => void
  onToggleFlag?: (flagged: boolean) => void
  onEmojiChange?: (emoji: string | null) => void
  className?: string
}

export default function InstructorFeedbackControls({
  annotation,
  emojiOptions = [],
  disabled = false,
  flagMode = 'toggle',
  onToggleStar,
  onToggleFlag,
  onEmojiChange,
  className = '',
}: InstructorFeedbackControlsProps): ReactElement | null {
  if (onToggleStar === undefined && onToggleFlag === undefined && onEmojiChange === undefined) {
    return null
  }

  const flagLabel = flagMode === 'add'
    ? (annotation.flagged ? 'Flagged note' : 'Flag note')
    : (annotation.flagged ? 'Unflag response' : 'Flag response')

  return (
    <div className={`flex flex-col items-center gap-2 shrink-0 pt-0.5${className ? ` ${className}` : ''}`}>
      {onToggleStar !== undefined && (
        <button
          type="button"
          aria-label={annotation.starred ? 'Unstar response' : 'Star response'}
          aria-pressed={annotation.starred}
          onClick={() => onToggleStar(!annotation.starred)}
          disabled={disabled}
          className={`rounded-lg px-1.5 py-1 text-lg leading-none ${
            annotation.starred
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500'
              : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
          } disabled:opacity-50`}
        >
          ★
        </button>
      )}

      {onToggleFlag !== undefined && (
        <button
          type="button"
          aria-label={flagLabel}
          aria-pressed={annotation.flagged}
          onClick={() => onToggleFlag(flagMode === 'add' ? true : !annotation.flagged)}
          disabled={disabled}
          className={`rounded-lg px-1.5 py-1 text-sm leading-none ${
            annotation.flagged
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-700'
              : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
          } disabled:opacity-50`}
        >
          🚩
        </button>
      )}

      {onEmojiChange !== undefined && (
        <div className="relative group">
          <button
            type="button"
            aria-label="Add emoji annotation"
            aria-haspopup="listbox"
            disabled={disabled}
            className="rounded-lg px-1.5 py-1 text-sm leading-none text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {annotation.emoji ?? '☺'}
          </button>
          <ul
            role="listbox"
            aria-label="Choose emoji"
            className="absolute left-full top-0 z-10 ml-2 hidden w-32 flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-lg group-focus-within:flex"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={annotation.emoji === null}
                onClick={() => onEmojiChange(null)}
                className="px-1 text-xs text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
              >
                none
              </button>
            </li>
            {emojiOptions.map((entry) => (
              <li key={entry.emoji}>
                <button
                  type="button"
                  role="option"
                  aria-selected={annotation.emoji === entry.emoji}
                  onClick={() => onEmojiChange(entry.emoji)}
                  className="text-base hover:bg-slate-100 dark:hover:bg-slate-700 rounded px-0.5"
                  aria-label={entry.label}
                >
                  {entry.emoji}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
