import { useEffect, useRef, useState } from 'react'
import type {
  InstructorAnnotation,
  MCQQuestion,
  Question,
  QuestionReveal,
  ResponseProgress,
  ResponseWithName,
} from '../../shared/types.js'
import ResponseCard from './ResponseCard.js'

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
      cellClassName: 'bg-sky-50',
      dotClassName: 'bg-sky-500',
    }
  }

  if (isCorrect) {
    return {
      cellClassName: 'bg-green-50',
      dotClassName: 'bg-green-600',
    }
  }

  if (isIncorrect) {
    return {
      cellClassName: 'bg-red-50',
      dotClassName: 'bg-red-500',
    }
  }

  return {
    cellClassName: '',
    dotClassName: 'bg-red-500',
  }
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

// ---------------------------------------------------------------------------
// MCQ table view
// ---------------------------------------------------------------------------

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
  const isPoll = !options.some((option) => option.isCorrect)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="pr-4 py-1 font-medium">Student</th>
            {options.map((opt) => (
              <th
                key={opt.id}
                className={`min-w-[120px] px-3 py-2 font-medium text-center ${opt.isCorrect ? 'text-green-700' : ''}`}
              >
                {opt.text}
                {opt.isCorrect && <span className="ml-1 text-green-600">✓</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {progress.map((entry) => {
            const responseId = entry.responseId
            const selectedOptionId =
              entry.answer?.type === 'multiple-choice' ? entry.answer.selectedOptionId : null
            const annotation = responseId
              ? (annotations[responseId] ?? { starred: false, flagged: false, emoji: null })
              : { starred: false, flagged: false, emoji: null }
            const selectedOption = options.find((o) => o.id === selectedOptionId)
            const isCorrect = selectedOption?.isCorrect === true
            const isIncorrect = selectedOptionId !== null && selectedOption?.isCorrect === false && options.some((o) => o.isCorrect)

            return (
              <tr
                key={`${entry.studentId}:${entry.questionId}`}
                className="border-b border-gray-100 hover:bg-gray-50"
              >
                <td className="pr-4 py-1.5 font-medium text-gray-700 max-w-[120px] truncate">
                  <span title={entry.studentName}>{entry.studentName}</span>
                  <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    entry.status === 'submitted'
                      ? 'bg-green-100 text-green-700'
                      : entry.status === 'working'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}>
                    {entry.status === 'submitted' ? 'Submitted' : entry.status === 'working' ? 'Still working' : 'Not started'}
                  </span>
                  {annotation.starred && <span className="ml-1 text-yellow-400">★</span>}
                  {annotation.flagged && <span className="ml-1 text-red-500">🚩</span>}
                </td>
                {options.map((opt) => {
                  const chosen = opt.id === selectedOptionId
                  const selectionTone = getMcqSelectionTone({
                    isPoll,
                    isCorrect,
                    isIncorrect,
                  })
                  return (
                    <td
                      key={opt.id}
                      className={`px-3 py-2 text-center align-middle ${
                        chosen
                          ? selectionTone.cellClassName
                          : ''
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
  // Apply order overrides: put overridden IDs first in the given order, then any remaining.
  const overrideSet = new Set(normalizedOrderOverrides)
  const progressByResponseId = new Map(progress.filter((entry) => entry.responseId).map((entry) => [entry.responseId as string, entry]))
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
  const [displayOrderIds, setDisplayOrderIds] = useState<string[]>(displayItemIds)
  const activeReactionSummaryByResponseId = new Map<string, Record<string, number>>(
    (activeReveal?.sharedResponses ?? []).map((sharedResponse: QuestionReveal['sharedResponses'][number]) => [sharedResponse.id, sharedResponse.reactions]),
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
        const item = displayItems.find((entry) => entry.id === itemId)
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
                setDisplayOrderIds((current) => (areIdsEqual(current, reorderedIds) ? current : reorderedIds))
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
              reactionSummary={item.submittedResponseId !== null ? activeReactionSummaryByResponseId.get(item.submittedResponseId) : undefined}
              status={item.status}
              onAnnotate={(patch) => {
                if (item.submittedResponseId !== null) {
                  onAnnotate(item.submittedResponseId, patch)
                }
              }}
              onShare={item.submittedResponseId !== null && onShareResponse ? () => onShareResponse(item.submittedResponseId) : undefined}
              shareLabel={item.submittedResponseId !== null && activeSharedResponseId === item.submittedResponseId ? 'Stop sharing' : 'Share'}
              shareActive={item.submittedResponseId !== null && activeSharedResponseId === item.submittedResponseId}
              draggable
              isDragging={false}
              hideWhileDragging={hiddenDraggedResponseId === item.id}
              isDragTarget={draggedResponseId !== null && dragOverResponseId === item.id && draggedResponseId !== item.id}
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
              onMoveDown={idx < displayOrderIds.length - 1 ? () => moveItem(idx, idx + 1) : undefined}
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
            setDisplayOrderIds((current) => (areIdsEqual(current, reorderedIds) ? current : reorderedIds))
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
