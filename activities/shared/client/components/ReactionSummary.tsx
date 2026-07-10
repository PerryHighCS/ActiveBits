import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
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
  triggerPosition?: 'start' | 'end'
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
  triggerPosition = 'start',
}: ReactionSummaryProps): ReactElement | null {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const optionByValue = new Map(options.map((option) => [option.value, option]))
  const reactionEntries = Object.entries(reactions).filter(([, count]) => (count ?? 0) > 0)
  const selectedOption = viewerReaction != null ? optionByValue.get(viewerReaction) : undefined
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === viewerReaction))

  const closePicker = (restoreFocus = false) => {
    setIsPickerOpen(false)
    if (restoreFocus) {
      triggerRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!isPickerOpen) return undefined
    setFocusedIndex(selectedIndex)
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : window.setTimeout.bind(window)
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window)
    const animationFrame = scheduleFrame(() => {
      optionRefs.current[selectedIndex]?.focus()
    })
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node | null) !== true) {
        closePicker()
      }
    }
    window.addEventListener('mousedown', handleOutsideClick)
    return () => {
      cancelFrame(animationFrame)
      window.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [isPickerOpen, selectedIndex])

  const focusOption = (index: number) => {
    const boundedIndex = Math.min(Math.max(index, 0), options.length - 1)
    setFocusedIndex(boundedIndex)
    optionRefs.current[boundedIndex]?.focus()
  }

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(focusedIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(focusedIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(options.length - 1)
    }
  }

  if (!canReact && reactionEntries.length === 0) {
    return null
  }

  const trigger = canReact && onReact !== undefined && (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-label={chooseLabel}
        aria-haspopup="listbox"
        aria-expanded={isPickerOpen}
        aria-controls={isPickerOpen ? listboxId : undefined}
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
          id={listboxId}
          role="listbox"
          aria-label={listLabel}
          onKeyDown={handleListboxKeyDown}
          className={`absolute z-10 flex w-40 flex-wrap gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-lg ${
            triggerPosition === 'end' ? 'right-0 bottom-full mb-1' : 'left-0 top-full mt-1'
          }`}
        >
          {options.map((entry, index) => (
            <li
              key={entry.value}
              role="presentation"
            >
              <button
                type="button"
                role="option"
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                aria-label={`React with ${entry.label}`}
                aria-selected={viewerReaction === entry.value}
                className={`rounded-lg px-1.5 py-1 text-base hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  viewerReaction === entry.value
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : ''
                }`}
                onClick={() => {
                  onReact(entry.value)
                  closePicker(true)
                }}
              >
                {entry.symbol}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const chips = reactionEntries.map(([reaction, count]) => {
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
  })

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs text-slate-400${className ? ` ${className}` : ''}`}>
      {triggerPosition === 'start' && trigger}
      {chips}
      {triggerPosition === 'end' && trigger}
    </div>
  )
}
