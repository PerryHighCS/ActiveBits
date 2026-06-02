import type { DragEvent } from 'react'
import type { InstructorAnnotation, ResponseProgressStatus, ResponseWithName } from '../../shared/types.js'
import { INSTRUCTOR_ANNOTATION_EMOJIS } from '../../shared/emojiSet.js'

interface Props {
  response: ResponseWithName
  annotation: InstructorAnnotation
  answerText: string
  reactionSummary?: Record<string, number>
  status?: ResponseProgressStatus
  onAnnotate(patch: Partial<InstructorAnnotation>): void
  onShare?(): void
  shareLabel?: string
  shareActive?: boolean
  onMoveUp?(): void
  onMoveDown?(): void
  draggable?: boolean
  isDragging?: boolean
  hideWhileDragging?: boolean
  isDragTarget?: boolean
  onDragStart?(): void
  onDragEnd?(): void
  onDragOver?(): void
  onDrop?(): void
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
  reactionSummary,
  status = 'submitted',
  onAnnotate,
  onShare,
  shareLabel = 'Share',
  shareActive = false,
  onMoveUp,
  onMoveDown,
  draggable = false,
  isDragging = false,
  hideWhileDragging = false,
  isDragTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props) {
  const reactionEntries = Object.entries(reactionSummary ?? {}).filter(([, count]) => count > 0)

  function setCardDragImage(event: DragEvent<HTMLDivElement>) {
    const source = event.currentTarget
    const clone = source.cloneNode(true)
    if (!(clone instanceof HTMLElement)) {
      return
    }

    clone.style.position = 'fixed'
    clone.style.top = '-1000px'
    clone.style.left = '-1000px'
    clone.style.width = `${source.offsetWidth}px`
    clone.style.pointerEvents = 'none'
    clone.style.transform = 'rotate(1deg)'
    clone.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.18)'
    clone.style.opacity = '0.96'
    document.body.appendChild(clone)
    event.dataTransfer.setDragImage(clone, 24, 24)
    window.setTimeout(() => {
      clone.remove()
    }, 150)
  }

  return (
    <div
      draggable={draggable}
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
        shareActive
          ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-900/20'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
      } ${draggable ? 'cursor-grab' : ''} ${isDragging ? 'scale-[1.01] opacity-60 shadow-lg' : ''} ${hideWhileDragging ? 'pointer-events-none opacity-0' : ''} ${isDragTarget ? 'ring-2 ring-indigo-200 dark:ring-indigo-700 ring-offset-1' : ''} transition-[box-shadow,transform,opacity]`}
      onDragStart={(event) => {
        if (!draggable) {
          return
        }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', response.id)
        setCardDragImage(event)
        onDragStart?.()
      }}
      onDragEnd={() => {
        if (!draggable) {
          return
        }
        onDragEnd?.()
      }}
      onDragOver={(event) => {
        if (onDragOver === undefined) {
          return
        }
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        if (onDrop === undefined) {
          return
        }
        event.preventDefault()
        onDrop()
      }}
    >
      {draggable && (
        <button
          type="button"
          aria-label={`Drag to reorder response from ${response.studentName}`}
          tabIndex={-1}
          className="self-stretch rounded-lg border border-transparent px-1 text-lg leading-none text-slate-300 dark:text-slate-600 hover:border-slate-200 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-500 dark:hover:text-slate-400"
        >
          <span className="flex h-full items-center">⋮⋮</span>
        </button>
      )}

      <div className="flex flex-col items-center gap-2 shrink-0 pt-0.5">
        <button
          type="button"
          aria-label={annotation.starred ? 'Unstar response' : 'Star response'}
          aria-pressed={annotation.starred}
          onClick={() => onAnnotate({ starred: !annotation.starred })}
          disabled={status !== 'submitted'}
          className={`rounded-lg px-1.5 py-1 text-lg leading-none ${
            annotation.starred
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500'
              : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
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
          className={`rounded-lg px-1.5 py-1 text-sm leading-none ${
            annotation.flagged
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-700'
              : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
          } disabled:opacity-50`}
        >
          🚩
        </button>

        <div className="relative group">
          <button
            type="button"
            aria-label="Add emoji annotation"
            aria-haspopup="listbox"
            disabled={status !== 'submitted'}
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
                onClick={() => onAnnotate({ emoji: null })}
                className="px-1 text-xs text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
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
                  className="text-base hover:bg-slate-100 dark:hover:bg-slate-700 rounded px-0.5"
                  aria-label={em.label}
                >
                  {em.emoji}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
            {response.studentName}
          </p>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${
              status === 'submitted'
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : status === 'working'
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
            }`}
          >
            {status === 'submitted' ? 'Submitted' : status === 'working' ? 'Still working' : 'Not started'}
          </span>
        </div>
        <p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap break-words">
          {answerText}
        </p>
        {reactionEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {reactionEntries.map(([emoji, count]) => (
              <span
                key={emoji}
                className="inline-flex items-center rounded-full border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 text-indigo-700 dark:text-indigo-300"
              >
                {emoji} {count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right-side actions */}
      <div className="flex items-center gap-1 shrink-0">
        {onShare !== undefined && (
          <button
            type="button"
            aria-label={`${shareLabel} response from ${response.studentName}`}
            onClick={onShare}
            disabled={status !== 'submitted'}
            className={`rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50 transition-colors ${
              shareActive
                ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200'
                : 'border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
            }`}
          >
            {shareLabel}
          </button>
        )}
        {(onMoveUp !== undefined || onMoveDown !== undefined) && (
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="Move response up"
              onClick={onMoveUp}
              disabled={onMoveUp === undefined}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 leading-none"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Move response down"
              onClick={onMoveDown}
              disabled={onMoveDown === undefined}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 leading-none"
            >
              ▼
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
