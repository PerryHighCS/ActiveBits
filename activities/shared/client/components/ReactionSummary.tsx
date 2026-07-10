import { useState, type ReactElement } from 'react'
import type { ReactionOption } from '../../reactions.js'

export type { ReactionOption }

interface ReactionSummaryProps {
  reactions: Record<string, number | undefined>
  options: readonly ReactionOption[]
  viewerReaction?: string | null
  canReact: boolean
  onReact?: (reaction: string) => void
  className?: string
  chooseLabel?: string
  listLabel?: string
}

export default function ReactionSummary({
  reactions,
  options,
  viewerReaction = null,
  canReact,
  onReact,
  className = '',
  chooseLabel = 'Choose reaction',
  listLabel = 'Choose reaction emoji',
}: ReactionSummaryProps): ReactElement | null {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const optionByValue = new Map(options.map((option) => [option.value, option]))
  const reactionEntries = Object.entries(reactions).filter(([, count]) => (count ?? 0) > 0)
  const selectedOption = viewerReaction != null ? optionByValue.get(viewerReaction) : undefined

  if (!canReact && reactionEntries.length === 0) {
    return null
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs text-slate-400${className ? ` ${className}` : ''}`}>
      {canReact && onReact !== undefined && (
        <div className="relative">
          <button
            type="button"
            aria-label={chooseLabel}
            aria-haspopup="listbox"
            aria-expanded={isPickerOpen}
            onClick={() => setIsPickerOpen((current) => !current)}
            className={`rounded-full border px-2 py-1 text-sm transition ${
              viewerReaction !== null
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-600'
            }`}
          >
            {selectedOption?.symbol ?? viewerReaction ?? '☺'}
          </button>
          {isPickerOpen && (
            <ul
              role="listbox"
              aria-label={listLabel}
              className="absolute left-0 top-full z-10 mt-1 flex w-40 flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-lg"
            >
              {options.map((entry) => (
                <li key={entry.value}>
                  <button
                    type="button"
                    role="option"
                    aria-label={`React with ${entry.label}`}
                    aria-selected={viewerReaction === entry.value}
                    className={`rounded-lg px-1.5 py-1 text-base hover:bg-slate-100 dark:hover:bg-slate-700 ${
                      viewerReaction === entry.value
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : ''
                    }`}
                    onClick={() => {
                      onReact(entry.value)
                      setIsPickerOpen(false)
                    }}
                  >
                    {entry.symbol}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {reactionEntries.map(([reaction, count]) => {
        const option = optionByValue.get(reaction)
        return (
          <span
            key={reaction}
            className={`inline-flex items-center rounded-full border px-2 py-1 ${
              viewerReaction === reaction
                ? 'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            {option?.symbol ?? reaction} {count}
          </span>
        )
      })}
    </div>
  )
}
