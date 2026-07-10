import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'

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
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [focusedEmojiIndex, setFocusedEmojiIndex] = useState(0)
  const emojiContainerRef = useRef<HTMLDivElement | null>(null)
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null)
  const emojiOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const emojiListboxId = useId()
  const emojiOptionCount = emojiOptions.length + 1

  const closeEmojiPicker = (restoreFocus = false) => {
    setEmojiOpen(false)
    if (restoreFocus) {
      emojiTriggerRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!emojiOpen) return undefined
    setFocusedEmojiIndex(0)
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : window.setTimeout.bind(window)
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window)
    const animationFrame = scheduleFrame(() => emojiOptionRefs.current[0]?.focus())
    function handleOutsideClick(event: MouseEvent) {
      if (emojiContainerRef.current?.contains(event.target as Node | null) !== true) {
        closeEmojiPicker()
      }
    }
    window.addEventListener('mousedown', handleOutsideClick)
    return () => {
      cancelFrame(animationFrame)
      window.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [emojiOpen])

  const focusEmojiOption = (index: number) => {
    const boundedIndex = Math.min(Math.max(index, 0), emojiOptionCount - 1)
    setFocusedEmojiIndex(boundedIndex)
    emojiOptionRefs.current[boundedIndex]?.focus()
  }

  const handleEmojiListboxKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEmojiPicker(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusEmojiOption(focusedEmojiIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusEmojiOption(focusedEmojiIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusEmojiOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusEmojiOption(emojiOptionCount - 1)
    }
  }

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
        <div className="relative" ref={emojiContainerRef}>
          <button
            type="button"
            ref={emojiTriggerRef}
            aria-label="Add emoji annotation"
            aria-haspopup="listbox"
            aria-expanded={emojiOpen}
            aria-controls={emojiOpen ? emojiListboxId : undefined}
            onClick={() => setEmojiOpen((open) => !open)}
            disabled={disabled}
            className="rounded-lg px-1.5 py-1 text-sm leading-none text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {annotation.emoji ?? '☺'}
          </button>
          {emojiOpen && (
            <ul
              id={emojiListboxId}
              role="listbox"
              aria-label="Choose emoji"
              onKeyDown={handleEmojiListboxKeyDown}
              className="absolute left-full top-0 z-10 ml-2 flex w-32 flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-lg"
            >
              <li
                role="presentation"
              >
                <button
                  type="button"
                  role="option"
                  ref={(node) => {
                    emojiOptionRefs.current[0] = node
                  }}
                  aria-label="No emoji annotation"
                  aria-selected={annotation.emoji === null}
                  onClick={() => {
                    onEmojiChange(null)
                    closeEmojiPicker(true)
                  }}
                  className="px-1 text-xs text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                >
                  none
                </button>
              </li>
              {emojiOptions.map((entry, index) => (
                <li
                  key={entry.emoji}
                  role="presentation"
                >
                  <button
                    type="button"
                    role="option"
                    ref={(node) => {
                      emojiOptionRefs.current[index + 1] = node
                    }}
                    aria-label={entry.label}
                    aria-selected={annotation.emoji === entry.emoji}
                    onClick={() => {
                      onEmojiChange(entry.emoji)
                      closeEmojiPicker(true)
                    }}
                    className="text-base hover:bg-slate-100 dark:hover:bg-slate-700 rounded px-0.5"
                  >
                    {entry.emoji}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
