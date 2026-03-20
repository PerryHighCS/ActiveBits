import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { InstructorAnnotation, Question } from '../../shared/types.js'
import { useInstructorState } from '../hooks/useInstructorState.js'
import ResponseViewer from './ResponseViewer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = 'resonance_instructor_'

function getPasscode(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
  } catch {
    return null
  }
}

function buildNewQuestion(text: string, type: Question['type']): Question {
  const id = `q_${Date.now().toString(36)}`
  if (type === 'free-response') {
    return { id, type: 'free-response', text, order: 0 }
  }
  return {
    id,
    type: 'multiple-choice',
    text,
    order: 0,
    options: [
      { id: `${id}_a`, text: 'Option A' },
      { id: `${id}_b`, text: 'Option B' },
    ],
  }
}

// ---------------------------------------------------------------------------
// SharePanel: inline share-results flow
// ---------------------------------------------------------------------------

interface SharePanelProps {
  questionId: string
  isMCQ: boolean
  hasMCQCorrectAnswer: boolean
  selectedIds: Set<string>
  onShare(correctOptionIds: string[] | null): void
  onCancel(): void
  mcqCorrectOptionIds?: string[]
}

function SharePanel({ questionId: _questionId, isMCQ, hasMCQCorrectAnswer, selectedIds, onShare, onCancel, mcqCorrectOptionIds }: SharePanelProps) {
  const [revealCorrect, setRevealCorrect] = useState(hasMCQCorrectAnswer)

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-3">
      <p className="text-sm font-medium text-rose-800">
        Share {selectedIds.size} selected response{selectedIds.size !== 1 ? 's' : ''} with students
      </p>

      {isMCQ && mcqCorrectOptionIds !== undefined && mcqCorrectOptionIds.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={revealCorrect}
            onChange={(e) => setRevealCorrect(e.target.checked)}
            className="accent-rose-600"
          />
          Reveal correct answer
        </label>
      )}

      {isMCQ && (mcqCorrectOptionIds === undefined || mcqCorrectOptionIds.length === 0) && (
        <p className="text-xs text-gray-500">Poll question — no correct answer to reveal.</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onShare(isMCQ && revealCorrect && mcqCorrectOptionIds ? mcqCorrectOptionIds : null)}
          disabled={selectedIds.size === 0}
          className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          Share
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddQuestionForm: quick inline question creation
// ---------------------------------------------------------------------------

function AddQuestionForm({ onAdd }: { onAdd(q: Question): void }) {
  const [text, setText] = useState('')
  const [type, setType] = useState<Question['type']>('free-response')
  const canAdd = text.trim().length > 0

  return (
    <div className="border-t border-gray-200 pt-3 mt-3 space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add question</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Question text…"
        rows={2}
        className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm resize-none focus:border-rose-400 focus:outline-none"
        aria-label="New question text"
      />
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Question['type'])}
          className="rounded border border-gray-200 px-2 py-1 text-sm"
          aria-label="Question type"
        >
          <option value="free-response">Free response</option>
          <option value="multiple-choice">Multiple choice</option>
        </select>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            onAdd(buildNewQuestion(text.trim(), type))
            setText('')
          }}
          className="rounded bg-gray-700 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResonanceManager
// ---------------------------------------------------------------------------

/**
 * Live instructor view for a Resonance session.
 *
 * Reads the instructor passcode from sessionStorage (stored by
 * createSessionBootstrap), polls the session state, and provides:
 * - Question list with activation controls
 * - Response review (MCQ table or free-response list) with annotation
 * - Share-results flow with correct-answer reveal toggle
 * - Quick inline question creation
 * - Link to the Resonance Tools page for report access and question editing
 */
export default function ResonanceManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const [passcode, setPasscode] = useState<string | null>(null)
  const [shareMode, setShareMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<string | null>(null)

  // Resolve passcode from sessionStorage on mount.
  useEffect(() => {
    if (!sessionId) return
    const stored = getPasscode(sessionId)
    setPasscode(stored)
  }, [sessionId])

  const { snapshot, loading, error, refresh } = useInstructorState(
    sessionId ?? null,
    passcode,
  )

  // Default active tab to the first question when data loads.
  useEffect(() => {
    if (snapshot !== null && activeTab === null && snapshot.questions.length > 0) {
      setActiveTab(snapshot.questions[0]?.id ?? null)
    }
  }, [snapshot, activeTab])

  // ---------------------------------------------------------------------------
  // Instructor actions
  // ---------------------------------------------------------------------------

  const callInstructor = useCallback(
    async (path: string, body: unknown) => {
      if (!sessionId || passcode === null) return
      await fetch(`/api/resonance/${sessionId}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Instructor-Passcode': passcode,
        },
        body: JSON.stringify(body),
      })
      void refresh()
    },
    [sessionId, passcode, refresh],
  )

  const activateQuestion = useCallback(
    (questionId: string | null) => void callInstructor('/activate-question', { questionId }),
    [callInstructor],
  )

  const annotateResponse = useCallback(
    (responseId: string, patch: Partial<InstructorAnnotation>) =>
      void callInstructor('/annotate-response', { responseId, annotation: patch }),
    [callInstructor],
  )

  const reorderResponses = useCallback(
    (questionId: string, orderedResponseIds: string[]) =>
      void callInstructor('/reorder-responses', { questionId, orderedResponseIds }),
    [callInstructor],
  )

  const shareResults = useCallback(
    (questionId: string, selectedResponseIds: string[], correctOptionIds: string[] | null) =>
      void callInstructor('/share-results', { questionId, selectedResponseIds, correctOptionIds }),
    [callInstructor],
  )

  const addQuestion = useCallback(
    (question: Question) => void callInstructor('/add-question', question),
    [callInstructor],
  )

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (!sessionId) {
    return <div className="p-6 text-gray-500">No active session.</div>
  }

  if (passcode === null) {
    return (
      <div className="p-6 text-gray-500">
        Instructor passcode not found in session storage. Try re-entering from the session creation link.
      </div>
    )
  }

  if (loading && snapshot === null) {
    return <div className="p-6 text-gray-400">Loading session…</div>
  }

  if (error !== null && snapshot === null) {
    return <div className="p-6 text-red-600">{error}</div>
  }

  if (snapshot === null) return null

  const { questions, activeQuestionId, students, responses, annotations, reveals, responseOrderOverrides } = snapshot

  // Question shown in the viewer panel.
  const viewingQuestion = questions.find((q) => q.id === activeTab) ?? null

  // Responses for the viewed question.
  const viewingResponses = viewingQuestion
    ? responses.filter((r) => r.questionId === viewingQuestion.id)
    : []

  const viewingOrderOverrides =
    viewingQuestion ? (responseOrderOverrides[viewingQuestion.id] ?? []) : []

  const viewingReveal = viewingQuestion
    ? reveals.find((rv) => rv.questionId === viewingQuestion.id)
    : null

  const mcqCorrectOptionIds =
    viewingQuestion?.type === 'multiple-choice'
      ? viewingQuestion.options.filter((o) => o.isCorrect).map((o) => o.id)
      : undefined

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-gray-900">Resonance</h1>
          <span className="text-xs text-gray-400 font-mono">{sessionId.slice(0, 8)}</span>
          <span className="text-xs text-gray-500">{students.length} student{students.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {error !== null && (
            <span className="text-xs text-amber-600">{error}</span>
          )}
          <a
            href="/util/resonance"
            className="text-sm text-rose-600 hover:text-rose-700 font-medium"
          >
            Resonance Tools ↗
          </a>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Left panel: question list */}
        <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
          <div className="p-3 space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Questions
            </p>

            {questions.length === 0 && (
              <p className="text-xs text-gray-400 italic">No questions yet.</p>
            )}

            {questions.map((q) => {
              const isActive = q.id === activeQuestionId
              const isViewing = q.id === activeTab
              const responseCount = responses.filter((r) => r.questionId === q.id).length
              const hasReveal = reveals.some((rv) => rv.questionId === q.id)

              return (
                <div
                  key={q.id}
                  className={`rounded-md border px-2 py-2 cursor-pointer text-sm transition-colors ${
                    isViewing ? 'border-rose-300 bg-rose-50' : 'border-gray-100 hover:border-gray-300'
                  }`}
                  onClick={() => setActiveTab(q.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isViewing}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab(q.id) }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs text-gray-700 truncate flex-1">{q.text}</p>
                    {isActive && (
                      <span className="text-[10px] bg-rose-500 text-white rounded px-1 shrink-0">Live</span>
                    )}
                    {hasReveal && !isActive && (
                      <span className="text-[10px] text-gray-400 shrink-0">Shared</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-gray-400">{responseCount} resp.</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={isActive ? 'Deactivate question' : 'Activate question'}
                        aria-pressed={isActive}
                        onClick={(e) => {
                          e.stopPropagation()
                          activateQuestion(isActive ? null : q.id)
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isActive
                            ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {isActive ? 'Stop' : 'Start'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            <AddQuestionForm onAdd={addQuestion} />
          </div>
        </aside>

        {/* Right panel: response viewer */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          {viewingQuestion === null ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a question from the left panel.
            </div>
          ) : (
            <>
              {/* Question header */}
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 space-y-1">
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  {viewingQuestion.type === 'free-response' ? 'Free response' : 'Multiple choice'}
                  {viewingQuestion.id === activeQuestionId && (
                    <span className="ml-2 text-rose-600 font-medium">● Live</span>
                  )}
                </p>
                <p className="text-base font-medium text-gray-900">{viewingQuestion.text}</p>
                <p className="text-xs text-gray-400">
                  {viewingResponses.length} of {students.length} responded
                  {viewingReveal !== null && (
                    <span className="ml-2 text-green-600">● Results shared</span>
                  )}
                </p>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-2">
                {!shareMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShareMode(true)
                      setSelectedIds(new Set())
                    }}
                    className="rounded border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Share results…
                  </button>
                ) : null}
                {viewingQuestion.id === activeQuestionId ? (
                  <button
                    type="button"
                    onClick={() => activateQuestion(null)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Stop question
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => activateQuestion(viewingQuestion.id)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Activate question
                  </button>
                )}
              </div>

              {/* Share panel */}
              {shareMode && (
                <SharePanel
                  questionId={viewingQuestion.id}
                  isMCQ={viewingQuestion.type === 'multiple-choice'}
                  hasMCQCorrectAnswer={mcqCorrectOptionIds !== undefined && mcqCorrectOptionIds.length > 0}
                  selectedIds={selectedIds}
                  mcqCorrectOptionIds={mcqCorrectOptionIds}
                  onShare={(correctOptionIds) => {
                    shareResults(viewingQuestion.id, Array.from(selectedIds), correctOptionIds)
                    setShareMode(false)
                    setSelectedIds(new Set())
                  }}
                  onCancel={() => {
                    setShareMode(false)
                    setSelectedIds(new Set())
                  }}
                />
              )}

              {/* Response viewer */}
              <ResponseViewer
                question={viewingQuestion}
                responses={viewingResponses}
                annotations={annotations}
                orderOverrides={viewingOrderOverrides}
                shareMode={shareMode}
                selectedIds={selectedIds}
                onAnnotate={annotateResponse}
                onReorder={(orderedIds) => reorderResponses(viewingQuestion.id, orderedIds)}
                onSelectToggle={(id) =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) {
                      next.delete(id)
                    } else {
                      next.add(id)
                    }
                    return next
                  })
                }
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
