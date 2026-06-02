import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCorrectOptionIds, getAnswerSelectedOptionIds, isMcqAnswerCorrect } from '../../shared/mcq.js'
import type {
  InstructorAnnotation,
  MCQQuestion,
  Question,
  QuestionReveal,
  ResponseProgress,
  ResponseWithName,
} from '../../shared/types.js'
import FormattedMarkdown from '../components/FormattedMarkdown.js'
import ResponseCard, { getResponseProgressStatusLabel } from './ResponseCard.js'

export function getMcqOptionColumnLabel(index: number): string {
  const alphabetLength = 26
  let remaining = index
  let label = ''

  do {
    label = String.fromCharCode(65 + (remaining % alphabetLength)) + label
    remaining = Math.floor(remaining / alphabetLength) - 1
  } while (remaining >= 0)

  return label
}

export function reorderResponseIds(currentIds: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) {
    return currentIds
  }

  const fromIndex = currentIds.indexOf(draggedId)
  const targetIndex = currentIds.indexOf(targetId)
  if (fromIndex === -1 || targetIndex === -1) {
    return currentIds
  }

  const reordered = [...currentIds]
  const [moved] = reordered.splice(fromIndex, 1)
  if (moved === undefined) {
    return currentIds
  }
  reordered.splice(targetIndex, 0, moved)
  return reordered
}

export function moveResponseIdToEnd(currentIds: string[], draggedId: string): string[] {
  const fromIndex = currentIds.indexOf(draggedId)
  if (fromIndex === -1 || fromIndex === currentIds.length - 1) {
    return currentIds
  }

  const reordered = [...currentIds]
  const [moved] = reordered.splice(fromIndex, 1)
  if (moved === undefined) {
    return currentIds
  }
  reordered.push(moved)
  return reordered
}

export function mergeDisplayOrder(currentIds: string[], availableIds: string[]): string[] {
  const availableIdSet = new Set(availableIds)
  const preserved = currentIds.filter((id) => availableIdSet.has(id))
  const preservedSet = new Set(preserved)
  const appended = availableIds.filter((id) => !preservedSet.has(id))
  return [...preserved, ...appended]
}

function areIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function normalizeOrderOverrides(orderOverrides: string[] | unknown): string[] {
  return Array.isArray(orderOverrides)
    ? orderOverrides.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function getMcqSelectionTone({
  isPoll,
  isCorrect,
  isIncorrect,
}: {
  isPoll: boolean
  isCorrect: boolean
  isIncorrect: boolean
}): {
  cellClassName: string
  dotClassName: string
} {
  if (isPoll) {
    return {
      cellClassName: 'bg-indigo-50 dark:bg-indigo-900/20',
      dotClassName: 'bg-indigo-500',
    }
  }

  if (isCorrect) {
    return {
      cellClassName: 'bg-emerald-50 dark:bg-emerald-900/20',
      dotClassName: 'bg-emerald-600',
    }
  }

  if (isIncorrect) {
    return {
      cellClassName: 'bg-red-50/70 dark:bg-red-900/10',
      dotClassName: 'bg-red-500',
    }
  }

  return {
    cellClassName: '',
    dotClassName: 'bg-red-500',
  }
}

export function isIncorrectMcqSelection({
  selectedOptionIds,
  options,
}: {
  selectedOptionIds: string[]
  options: MCQQuestion['options']
}): boolean {
  if (selectedOptionIds.length === 0) {
    return false
  }

  const correctOptionIds = getCorrectOptionIds(options)
  if (correctOptionIds.length === 0) {
    return false
  }

  return !isMcqAnswerCorrect(selectedOptionIds, correctOptionIds)
}

interface Props {
  question: Question
  responses: ResponseWithName[]
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  activeSharedResponseId?: string | null
  activeReveal?: QuestionReveal | null
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onShareResponse?(responseId: string): void
  onReorder(newOrder: string[]): void
}

interface McqOptionPreviewPosition {
  anchorTop: number
  belowTop: number
  belowMaxHeight: number
  aboveMaxHeight: number
  left: number
  top: number
  width: number
  maxHeight: number
}

const MCQ_OPTION_PREVIEW_WIDTH = 360
const MCQ_OPTION_PREVIEW_MAX_HEIGHT = 320
const MCQ_OPTION_PREVIEW_GAP = 14

// ---------------------------------------------------------------------------
// MCQ table view
// ---------------------------------------------------------------------------

function getOptionPreviewPosition(anchor: HTMLElement): McqOptionPreviewPosition {
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(MCQ_OPTION_PREVIEW_WIDTH, Math.max(280, window.innerWidth - 24))
  const left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 12,
  )
  const belowTop = rect.bottom + MCQ_OPTION_PREVIEW_GAP
  const belowMaxHeight = window.innerHeight - belowTop - 12
  const aboveMaxHeight = rect.top - MCQ_OPTION_PREVIEW_GAP - 12
  const maxHeight = Math.max(
    64,
    Math.min(MCQ_OPTION_PREVIEW_MAX_HEIGHT, belowMaxHeight),
  )

  return {
    anchorTop: rect.top,
    belowTop,
    belowMaxHeight,
    aboveMaxHeight,
    left,
    top: belowTop,
    width,
    maxHeight,
  }
}

function getMeasuredOptionPreviewPosition(
  current: McqOptionPreviewPosition,
  measuredHeight: number,
): McqOptionPreviewPosition {
  const preferredHeight = Math.min(MCQ_OPTION_PREVIEW_MAX_HEIGHT, measuredHeight)
  const shouldOpenAbove =
    current.belowMaxHeight < preferredHeight &&
    current.aboveMaxHeight > current.belowMaxHeight

  if (!shouldOpenAbove) {
    return {
      ...current,
      top: current.belowTop,
      maxHeight: Math.max(64, Math.min(MCQ_OPTION_PREVIEW_MAX_HEIGHT, current.belowMaxHeight)),
    }
  }

  const maxHeight = Math.max(64, Math.min(MCQ_OPTION_PREVIEW_MAX_HEIGHT, current.aboveMaxHeight))
  const actualHeight = Math.min(preferredHeight, maxHeight)

  return {
    ...current,
    top: Math.max(12, current.anchorTop - MCQ_OPTION_PREVIEW_GAP - actualHeight),
    maxHeight,
  }
}

function MCQOptionPreview({
  option,
  initialPosition,
  onMouseEnter,
  onMouseLeave,
}: {
  option: MCQQuestion['options'][number]
  initialPosition: McqOptionPreviewPosition
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(initialPosition)

  useLayoutEffect(() => {
    setPosition(initialPosition)
  }, [initialPosition])

  useLayoutEffect(() => {
    const preview = previewRef.current
    if (preview === null) {
      return
    }

    const measuredPosition = getMeasuredOptionPreviewPosition(initialPosition, preview.scrollHeight)
    setPosition((current) => (
      current.top === measuredPosition.top &&
      current.maxHeight === measuredPosition.maxHeight
        ? current
        : measuredPosition
    ))
  }, [initialPosition])

  return (
    <div
      ref={previewRef}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-left normal-case tracking-normal shadow-xl"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
      }}
    >
      <FormattedMarkdown
        markdown={option.text}
        variant="inline"
        className="text-sm text-slate-700 dark:text-slate-200"
      />
    </div>
  )
}

function MCQOptionHeader({
  option,
  label,
}: {
  option: MCQQuestion['options'][number]
  label: string
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const hidePreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewPosition, setPreviewPosition] = useState<McqOptionPreviewPosition | null>(null)

  function cancelHidePreview() {
    if (hidePreviewTimeoutRef.current === null) {
      return
    }
    clearTimeout(hidePreviewTimeoutRef.current)
    hidePreviewTimeoutRef.current = null
  }

  function showPreview() {
    cancelHidePreview()
    if (buttonRef.current === null || typeof window === 'undefined') {
      return
    }
    setPreviewPosition(getOptionPreviewPosition(buttonRef.current))
  }

  function hidePreview() {
    cancelHidePreview()
    setPreviewPosition(null)
  }

  function scheduleHidePreview() {
    cancelHidePreview()
    hidePreviewTimeoutRef.current = setTimeout(() => {
      setPreviewPosition(null)
      hidePreviewTimeoutRef.current = null
    }, 120)
  }

  useEffect(() => {
    return cancelHidePreview
  }, [])

  return (
    <div
      className="inline-flex justify-center"
      onMouseEnter={showPreview}
      onMouseLeave={scheduleHidePreview}
      onFocus={showPreview}
      onBlur={hidePreview}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-semibold ring-offset-2 ring-offset-white focus:outline-none focus:ring-2 dark:ring-offset-slate-800 ${
          option.isCorrect
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 focus:ring-emerald-500'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:ring-indigo-500'
        }`}
        aria-label={`Option ${label}${option.isCorrect ? ', correct answer' : ''}`}
      >
        {label}
        {option.isCorrect && <span className="ml-1">✓</span>}
      </button>
      {previewPosition !== null && typeof document !== 'undefined' && createPortal(
        <MCQOptionPreview
          option={option}
          initialPosition={previewPosition}
          onMouseEnter={cancelHidePreview}
          onMouseLeave={scheduleHidePreview}
        />,
        document.body,
      )}
    </div>
  )
}

function MCQTable({
  question,
  progress,
  annotations,
}: {
  question: MCQQuestion
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
}) {
  const options = question.options
  const correctOptionIds = getCorrectOptionIds(options)
  const isPoll = correctOptionIds.length === 0

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((opt, index) => {
            const label = getMcqOptionColumnLabel(index)
            return (
              <div
                key={opt.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                  opt.isCorrect
                    ? 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                }`}
              >
                <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-semibold ${
                  opt.isCorrect
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}>
                  {label}
                </span>
                <FormattedMarkdown
                  markdown={opt.text}
                  variant="inline"
                  className="min-w-0 text-sm text-slate-700 dark:text-slate-300"
                />
              </div>
            )
          })}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="pr-4 pl-3 py-2.5 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Student
              </th>
              {options.map((opt, index) => (
                <th
                  key={opt.id}
                  className={`min-w-16 px-3 py-2.5 font-medium text-xs text-center uppercase tracking-wide ${
                    opt.isCorrect
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <MCQOptionHeader
                    option={opt}
                    label={getMcqOptionColumnLabel(index)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {progress.map((entry) => {
              const responseId = entry.responseId
              const selectedOptionIds =
                entry.answer?.type === 'multiple-choice'
                  ? getAnswerSelectedOptionIds(entry.answer)
                  : []
              const annotation = responseId
                ? (annotations[responseId] ?? { starred: false, flagged: false, emoji: null })
                : { starred: false, flagged: false, emoji: null }
              const isCorrect =
                correctOptionIds.length > 0 && isMcqAnswerCorrect(selectedOptionIds, correctOptionIds)
              const isIncorrect = isIncorrectMcqSelection({ selectedOptionIds, options })

              return (
                <tr
                  key={`${entry.studentId}:${entry.questionId}`}
                  className="border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                >
                  <td className="pr-4 pl-3 py-2 font-medium text-slate-700 dark:text-slate-300 max-w-[140px]">
                    <span className="truncate block" title={entry.studentName}>
                      {entry.studentName}
                    </span>
                    <span
                      className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        entry.status === 'submitted'
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                          : entry.status === 'working'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {getResponseProgressStatusLabel(entry.status)}
                    </span>
                    {annotation.starred && <span className="ml-1 text-yellow-400">★</span>}
                    {annotation.flagged && <span className="ml-1 text-red-500">🚩</span>}
                  </td>
                  {options.map((opt) => {
                    const chosen = selectedOptionIds.includes(opt.id)
                    const selectionTone = getMcqSelectionTone({
                      isPoll,
                      isCorrect,
                      isIncorrect,
                    })
                    return (
                      <td
                        key={opt.id}
                        className={`px-3 py-2 text-center align-middle ${
                          chosen ? selectionTone.cellClassName : ''
                        }`}
                      >
                        {chosen && (
                          <div className="flex justify-center">
                            <span
                              className={`inline-block h-5 w-5 rounded-full ${selectionTone.dotClassName}`}
                              aria-label={`Selected${isCorrect ? ', correct' : isIncorrect ? ', incorrect' : ''}`}
                            />
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {progress.length === 0 && (
              <tr>
                <td
                  colSpan={options.length + 1}
                  className="py-6 text-center text-sm text-slate-400 dark:text-slate-500 italic"
                >
                  No responses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  activeReveal,
  onAnnotate,
  onShareResponse,
  onReorder,
}: {
  responses: ResponseWithName[]
  progress: ResponseProgress[]
  annotations: Record<string, InstructorAnnotation>
  orderOverrides: string[]
  activeSharedResponseId?: string | null
  activeReveal?: QuestionReveal | null
  onAnnotate(responseId: string, patch: Partial<InstructorAnnotation>): void
  onShareResponse?(responseId: string): void
  onReorder(newOrder: string[]): void
}) {
  const [draggedResponseId, setDraggedResponseId] = useState<string | null>(null)
  const [hiddenDraggedResponseId, setHiddenDraggedResponseId] = useState<string | null>(null)
  const [dragOverResponseId, setDragOverResponseId] = useState<string | null>(null)
  const dragStartOrderRef = useRef<string[] | null>(null)
  const normalizedOrderOverrides = normalizeOrderOverrides(orderOverrides)
  const overrideSet = new Set(normalizedOrderOverrides)
  const progressByResponseId = new Map(
    progress
      .filter((entry) => entry.responseId)
      .map((entry) => [entry.responseId as string, entry]),
  )
  const submittedResponses = [
    ...normalizedOrderOverrides.map((id) => responses.find((r) => r.id === id)).filter(Boolean),
    ...responses.filter((r) => !overrideSet.has(r.id)),
  ] as ResponseWithName[]
  const pendingWithoutSubmission = progress
    .filter((entry) => entry.status !== 'submitted' && !entry.responseId)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  const displayItems = [
    ...submittedResponses.map((response) => {
      const status = progressByResponseId.get(response.id)?.status ?? 'submitted'
      return {
        id: response.id,
        response,
        annotation: annotations[response.id] ?? { starred: false, flagged: false, emoji: null },
        answerText: response.answer.type === 'free-response' ? response.answer.text : '',
        status,
        submittedResponseId: response.id,
      }
    }),
    ...pendingWithoutSubmission.map((entry) => ({
      id: `draft:${entry.studentId}:${entry.questionId}`,
      response: {
        id: `draft:${entry.studentId}:${entry.questionId}`,
        questionId: entry.questionId,
        studentId: entry.studentId,
        submittedAt: entry.updatedAt,
        answer: entry.answer ?? { type: 'free-response', text: '' },
        studentName: entry.studentName,
      } satisfies ResponseWithName,
      annotation: { starred: false, flagged: false, emoji: null },
      answerText:
        entry.answer?.type === 'free-response'
          ? entry.answer.text
          : entry.status === 'working'
            ? 'Working on a response…'
            : 'Has not started yet.',
      status: entry.status,
      submittedResponseId: null,
    })),
  ]
  const displayItemIds = displayItems.map((item) => item.id)
  const displayItemsById = new Map(displayItems.map((item) => [item.id, item]))
  const [displayOrderIds, setDisplayOrderIds] = useState<string[]>(displayItemIds)
  const activeReactionSummaryByResponseId = new Map<string, Record<string, number>>(
    (activeReveal?.sharedResponses ?? []).map(
      (sharedResponse: QuestionReveal['sharedResponses'][number]) => [
        sharedResponse.id,
        sharedResponse.reactions,
      ],
    ),
  )

  useEffect(() => {
    setDisplayOrderIds((current) => {
      const merged = mergeDisplayOrder(current, displayItemIds)
      return areIdsEqual(current, merged) ? current : merged
    })
  }, [displayItemIds])

  function moveItem(fromIndex: number, toIndex: number) {
    const ids = [...displayOrderIds]
    const moved = ids.splice(fromIndex, 1)[0]
    if (moved !== undefined) ids.splice(toIndex, 0, moved)
    setDisplayOrderIds(ids)
    onReorder(ids.filter((id) => !id.startsWith('draft:')))
  }

  function clearDragState() {
    setDraggedResponseId(null)
    setHiddenDraggedResponseId(null)
    setDragOverResponseId(null)
    dragStartOrderRef.current = null
  }

  return (
    <div className="flex h-full min-h-[24rem] flex-col gap-2">
      {displayOrderIds.map((itemId, idx) => {
        const item = displayItemsById.get(itemId)
        if (!item) {
          return null
        }

        return (
          <div
            key={item.id}
            className="space-y-2"
            onDragOver={(event) => {
              event.preventDefault()
              if (draggedResponseId !== null && draggedResponseId !== item.id) {
                const reorderedIds = reorderResponseIds(displayOrderIds, draggedResponseId, item.id)
                setDisplayOrderIds((current) =>
                  areIdsEqual(current, reorderedIds) ? current : reorderedIds,
                )
                setDragOverResponseId(item.id)
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggedResponseId === null) {
                return
              }
              onReorder(displayOrderIds.filter((id) => !id.startsWith('draft:')))
              clearDragState()
            }}
          >
            <ResponseCard
              response={item.response}
              annotation={item.annotation}
              answerText={item.answerText}
              reactionSummary={
                item.submittedResponseId !== null
                  ? activeReactionSummaryByResponseId.get(item.submittedResponseId)
                  : undefined
              }
              status={item.status}
              onAnnotate={(patch) => {
                if (item.submittedResponseId !== null) {
                  onAnnotate(item.submittedResponseId, patch)
                }
              }}
              onShare={
                item.submittedResponseId !== null && onShareResponse
                  ? () => onShareResponse(item.submittedResponseId)
                  : undefined
              }
              shareLabel={
                item.submittedResponseId !== null &&
                activeSharedResponseId === item.submittedResponseId
                  ? 'Stop sharing'
                  : 'Share'
              }
              shareActive={
                item.submittedResponseId !== null &&
                activeSharedResponseId === item.submittedResponseId
              }
              draggable
              isDragging={false}
              hideWhileDragging={hiddenDraggedResponseId === item.id}
              isDragTarget={
                draggedResponseId !== null &&
                dragOverResponseId === item.id &&
                draggedResponseId !== item.id
              }
              onDragStart={() => {
                dragStartOrderRef.current = [...displayOrderIds]
                setDraggedResponseId(item.id)
                setDragOverResponseId(item.id)
                window.setTimeout(() => {
                  setHiddenDraggedResponseId(item.id)
                }, 0)
              }}
              onDragEnd={() => {
                if (dragStartOrderRef.current !== null) {
                  setDisplayOrderIds(dragStartOrderRef.current)
                }
                clearDragState()
              }}
              onMoveUp={idx > 0 ? () => moveItem(idx, idx - 1) : undefined}
              onMoveDown={
                idx < displayOrderIds.length - 1 ? () => moveItem(idx, idx + 1) : undefined
              }
            />
          </div>
        )
      })}
      {draggedResponseId !== null && (
        <div
          aria-label="Move response to end"
          className="min-h-28 flex-1"
          onDragOver={(event) => {
            event.preventDefault()
            const reorderedIds = moveResponseIdToEnd(displayOrderIds, draggedResponseId)
            setDisplayOrderIds((current) =>
              areIdsEqual(current, reorderedIds) ? current : reorderedIds,
            )
            setDragOverResponseId('__end__')
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (draggedResponseId === null) {
              return
            }
            const reorderedIds = moveResponseIdToEnd(displayOrderIds, draggedResponseId)
            setDisplayOrderIds(reorderedIds)
            onReorder(reorderedIds.filter((id) => !id.startsWith('draft:')))
            clearDragState()
          }}
        />
      )}
      {displayItems.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 italic">No responses yet.</p>
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
  activeReveal,
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
      activeReveal={activeReveal}
      onAnnotate={onAnnotate}
      onShareResponse={onShareResponse}
      onReorder={onReorder}
    />
  )
}
