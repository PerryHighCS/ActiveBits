import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { consumeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import type { InstructorAnnotation, Question } from '../../shared/types.js'
import { useInstructorState } from '../hooks/useInstructorState.js'
import ResponseViewer from './ResponseViewer.js'
import QuestionBuilder from '../tools/QuestionBuilder.js'

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

function setStoredPasscode(sessionId: string, passcode: string): void {
  try {
    sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, passcode)
  } catch {
    // Best-effort cache only; the in-memory state still allows manager auth.
  }
}

function resolvePasscode(sessionId: string): string | null {
  // Primary: sessionStorage key written by createSessionBootstrap config.
  const fromStorage = getPasscode(sessionId)
  if (fromStorage !== null) return fromStorage

  // Fallback: bootstrap payload stored by the parent session manager
  // (e.g. SyncDeck) after launching this activity as an embedded session.
  const bootstrap = consumeCreateSessionBootstrapPayload('resonance', sessionId)
  if (bootstrap !== null && typeof bootstrap.instructorPasscode === 'string' && bootstrap.instructorPasscode.length > 0) {
    return bootstrap.instructorPasscode
  }

  return null
}

function formatRemainingTime(deadlineAt: number | null, now: number): string | null {
  if (deadlineAt === null) {
    return null
  }

  const remainingMs = Math.max(0, deadlineAt - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function shouldShowQuestionPanelActions(question: Question): boolean {
  return question.type === 'multiple-choice'
}

export function isQuestionStemVisuallyTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth' | 'clientHeight' | 'scrollHeight'> | null,
): boolean {
  if (element === null) {
    return false
  }

  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
}

export function toggleQuestionActivationSelection(current: string[], questionId: string): string[] {
  return current.includes(questionId)
    ? current.filter((id) => id !== questionId)
    : [...current, questionId]
}

export function toggleExpandedQuestionStem(current: string[], questionId: string): string[] {
  return current.includes(questionId)
    ? current.filter((id) => id !== questionId)
    : [...current, questionId]
}

export function normalizeActivationSelection(
  current: string[],
  availableQuestionIds: string[],
  liveQuestionIds: string[],
): string[] {
  const availableQuestionIdSet = new Set(availableQuestionIds)
  const filtered = current.filter((questionId) => availableQuestionIdSet.has(questionId))
  if (filtered.length > 0) {
    return filtered
  }

  const live = liveQuestionIds.filter((questionId) => availableQuestionIdSet.has(questionId))
  if (live.length > 0) {
    return live
  }

  return availableQuestionIds[0] ? [availableQuestionIds[0]] : []
}

// ---------------------------------------------------------------------------
// ResonanceManager
// ---------------------------------------------------------------------------

/**
 * Live instructor view for a Resonance session.
 *
 * Reads the instructor passcode from sessionStorage (stored by
 * createSessionBootstrap), polls the session state, and provides:
 * - Question list with live-state controls
 * - Response review (MCQ table or free-response list) with annotation
 * - Share-results flow with correct-answer reveal toggle
 * - Quick inline question creation
 * - Link to the Resonance Tools page for report access and question editing
 */
export default function ResonanceManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const [passcode, setPasscode] = useState<string | null>(null)
  const [isResolvingPasscode, setIsResolvingPasscode] = useState(true)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [activationSelectionIds, setActivationSelectionIds] = useState<string[]>([])
  const [expandedQuestionStemIds, setExpandedQuestionStemIds] = useState<string[]>([])
  const [overflowingQuestionStemIds, setOverflowingQuestionStemIds] = useState<string[]>([])
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const questionStemRefs = useRef<Record<string, HTMLParagraphElement | null>>({})

  // Resolve passcode from same-tab bootstrap state first, then recover it from
  // the server when this manager is running as an embedded child session.
  useEffect(() => {
    if (!sessionId) return
    let isCancelled = false
    const resolved = resolvePasscode(sessionId)
    if (resolved !== null) {
      setPasscode(resolved)
      setIsResolvingPasscode(false)
      return
    }

    setPasscode(null)
    setIsResolvingPasscode(true)

    const recoverPasscode = async () => {
      try {
        const response = await fetch(`/api/resonance/${encodeURIComponent(sessionId)}/instructor-passcode`, {
          credentials: 'include',
        })
        if (!response.ok) {
          if (!isCancelled) {
            setPasscode(null)
          }
          return
        }

        const payload = await response.json() as { instructorPasscode?: unknown }
        const recoveredPasscode =
          typeof payload.instructorPasscode === 'string' && payload.instructorPasscode.trim().length > 0
            ? payload.instructorPasscode.trim()
            : null
        if (!isCancelled) {
          setPasscode(recoveredPasscode)
          if (recoveredPasscode !== null) {
            setStoredPasscode(sessionId, recoveredPasscode)
          }
        }
      } catch {
        if (!isCancelled) {
          setPasscode(null)
        }
      } finally {
        if (!isCancelled) {
          setIsResolvingPasscode(false)
        }
      }
    }

    void recoverPasscode()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  const { snapshot, loading, error, refresh } = useInstructorState(
    sessionId ?? null,
    passcode,
  )

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  // Default active tab to the first question when data loads.
  useEffect(() => {
    if (snapshot !== null && activeTab === null && snapshot.questions.length > 0) {
      setActiveTab(snapshot.questions[0]?.id ?? null)
    }
  }, [snapshot, activeTab])

  useEffect(() => {
    if (snapshot === null) {
      return
    }

    const availableIds = snapshot.questions.map((question) => question.id)
    setActivationSelectionIds((current) => {
      return normalizeActivationSelection(current, availableIds, snapshot.activeQuestionIds)
    })
    setExpandedQuestionStemIds((current) => current.filter((questionId) => availableIds.includes(questionId)))
    setOverflowingQuestionStemIds((current) => current.filter((questionId) => availableIds.includes(questionId)))
    questionStemRefs.current = Object.fromEntries(
      Object.entries(questionStemRefs.current).filter(([questionId]) => availableIds.includes(questionId)),
    )
  }, [snapshot])

  useEffect(() => {
    if (snapshot === null) {
      return
    }

    const measureOverflow = () => {
      const overflowingQuestionIds = snapshot.questions
        .filter((question) => isQuestionStemVisuallyTruncated(questionStemRefs.current[question.id] ?? null))
        .map((question) => question.id)

      setOverflowingQuestionStemIds((current) => {
        if (
          current.length === overflowingQuestionIds.length
          && current.every((questionId, index) => questionId === overflowingQuestionIds[index])
        ) {
          return current
        }

        return overflowingQuestionIds
      })
    }

    const frameId = window.requestAnimationFrame(measureOverflow)
    window.addEventListener('resize', measureOverflow)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', measureOverflow)
    }
  }, [snapshot, expandedQuestionStemIds])

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

  const activateQuestions = useCallback(
    (questionIds: string[]) => void callInstructor('/activate-question', { questionIds }),
    [callInstructor],
  )

  const toggleActivationSelection = useCallback((questionId: string) => {
    setActivationSelectionIds((current) => toggleQuestionActivationSelection(current, questionId))
  }, [])

  const toggleQuestionStemExpansion = useCallback((questionId: string) => {
    setExpandedQuestionStemIds((current) => toggleExpandedQuestionStem(current, questionId))
  }, [])

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

  const stopSharing = useCallback(
    (questionId: string) => void callInstructor('/stop-sharing', { questionId }),
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

  if (isResolvingPasscode) {
    return (
      <div className="p-6 text-gray-500">
        Loading instructor session…
      </div>
    )
  }

  if (passcode === null) {
    return (
      <div className="p-6 text-gray-500">
        Instructor passcode not found. Try re-entering from the session creation link.
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

  const {
    questions,
    activeQuestionIds,
    activeQuestionDeadlineAt,
    students,
    responses,
    progress,
    annotations,
    reveals,
    responseOrderOverrides,
  } = snapshot
  const hasLiveRun = activeQuestionDeadlineAt === null || activeQuestionDeadlineAt > countdownNow
  const activeQuestionIdSet = new Set(hasLiveRun ? activeQuestionIds : [])
  const activationSelectionSet = new Set(activationSelectionIds)
  const expandedQuestionStemSet = new Set(expandedQuestionStemIds)
  const overflowingQuestionStemSet = new Set(overflowingQuestionStemIds)
  const liveCountdown = formatRemainingTime(activeQuestionDeadlineAt, countdownNow)
  const activeReveal = reveals[0] ?? null

  // Question shown in the viewer panel.
  const viewingQuestion = questions.find((q) => q.id === activeTab) ?? null

  // Responses for the viewed question.
  const viewingResponses = viewingQuestion
    ? responses.filter((r) => r.questionId === viewingQuestion.id)
    : []
  const viewingProgress = viewingQuestion
    ? progress.filter((entry) => entry.questionId === viewingQuestion.id)
    : []

  const viewingOrderOverrides =
    viewingQuestion ? (responseOrderOverrides[viewingQuestion.id] ?? []) : []

  const isViewingQuestionShared = activeReveal?.questionId === viewingQuestion?.id
  const activeSharedResponseId =
    viewingQuestion?.type === 'free-response' && isViewingQuestionShared
      ? (activeReveal?.sharedResponses[0]?.id ?? null)
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
          {liveCountdown !== null && activeQuestionIds.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-right">
              <p className="text-[10px] uppercase tracking-wide text-amber-700">Time left</p>
              <p className="text-sm font-semibold text-amber-900">{liveCountdown}</p>
            </div>
          )}
          {error !== null && (
            <span className="text-xs text-amber-600">{error}</span>
          )}
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Left panel: question list */}
        <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
          <div className="p-3 space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Build
            </p>
            <div className="pb-3">
              <button
                type="button"
                aria-expanded={isAddQuestionOpen}
                aria-controls="resonance-add-question-builder"
                onClick={() => setIsAddQuestionOpen((current) => !current)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-left text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-white"
              >
                <span>{isAddQuestionOpen ? 'Hide question builder' : 'Add question'}</span>
                <span className="text-sm text-gray-400">{isAddQuestionOpen ? '▴' : '▾'}</span>
              </button>
              {isAddQuestionOpen && (
                <div id="resonance-add-question-builder" className="mt-2">
                  <QuestionBuilder
                    nextOrder={questions.length}
                    onSave={(question) => {
                      addQuestion(question)
                      setIsAddQuestionOpen(false)
                    }}
                    onCancel={() => setIsAddQuestionOpen(false)}
                  />
                </div>
              )}
            </div>

            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 border-t border-gray-200 pt-3">
              Questions
            </p>

            {questions.length === 0 && (
              <p className="text-xs text-gray-400 italic">No questions yet.</p>
            )}

            {questions.length > 1 && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                <button
                  type="button"
                  onClick={() => setActivationSelectionIds(questions.map((question) => question.id))}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => activateQuestions(activationSelectionIds)}
                  disabled={activationSelectionIds.length === 0}
                    className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Activate
                </button>
                <button
                  type="button"
                  onClick={() => activateQuestion(null)}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                >
                  Stop
                </button>
              </div>
            )}

            {questions.map((q) => {
              const isActive = activeQuestionIdSet.has(q.id)
              const isSelectedForActivation = activationSelectionSet.has(q.id)
              const isStemExpanded = expandedQuestionStemSet.has(q.id)
              const isViewing = q.id === activeTab
              const responseCount = progress.filter((entry) => entry.questionId === q.id).length
              const hasReveal = reveals.some((rv) => rv.questionId === q.id)
              const canExpandStem = isStemExpanded || overflowingQuestionStemSet.has(q.id)

              return (
                <div
                  key={q.id}
                  className={`rounded-md border px-2 py-2 cursor-pointer text-sm transition-colors ${
                    isViewing ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:border-gray-300'
                  }`}
                  onClick={() => setActiveTab(q.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isViewing}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab(q.id) }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelectedForActivation}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleActivationSelection(q.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${q.text} for activation`}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        {isStemExpanded ? (
                          <div className="space-y-1">
                            <p
                              ref={(element) => {
                                questionStemRefs.current[q.id] = element
                              }}
                              className="text-xs text-gray-700 whitespace-normal break-words"
                            >
                              {q.text}
                            </p>
                            {canExpandStem && (
                              <button
                                type="button"
                                aria-expanded={isStemExpanded}
                                aria-label="Collapse question stem"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleQuestionStemExpansion(q.id)
                                }}
                                className="inline-flex items-center text-[10px] font-medium text-blue-700 hover:text-blue-800"
                              >
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 12 12"
                                  className="h-3 w-3"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M2.5 7.5 6 4.5l3.5 3" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-baseline gap-1 min-w-0">
                            <p
                              ref={(element) => {
                                questionStemRefs.current[q.id] = element
                              }}
                              className="flex-1 overflow-hidden whitespace-nowrap text-clip text-xs text-gray-700"
                            >
                              {q.text}
                            </p>
                            {canExpandStem && (
                              <button
                                type="button"
                                aria-expanded={isStemExpanded}
                                aria-label="Expand question stem"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleQuestionStemExpansion(q.id)
                                }}
                                className="shrink-0 text-[10px] font-medium leading-none text-blue-700 hover:text-blue-800"
                              >
                                ...
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[10px] bg-blue-500 text-white rounded px-1 shrink-0">Live</span>
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
                        aria-label={isSelectedForActivation ? 'Remove question from selected activation set' : 'Add question to selected activation set'}
                        aria-pressed={isSelectedForActivation}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleActivationSelection(q.id)
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isSelectedForActivation
                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {isSelectedForActivation ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

          </div>
        </aside>

        {/* Right panel: response viewer */}
        <main className="flex flex-1 flex-col overflow-y-auto p-4 gap-4">
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
                  {activeQuestionIdSet.has(viewingQuestion.id) && (
                    <span className="ml-2 text-blue-600 font-medium">● Live</span>
                  )}
                </p>
                <p className="text-base font-medium text-gray-900">{viewingQuestion.text}</p>
                <p className="text-xs text-gray-400">
                  {viewingResponses.length} of {students.length} responded
                  {isViewingQuestionShared && (
                    <span className="ml-2 text-green-600">● Results shared</span>
                  )}
                </p>
              </div>

              {/* Action bar */}
              {shouldShowQuestionPanelActions(viewingQuestion) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isViewingQuestionShared) {
                        stopSharing(viewingQuestion.id)
                        return
                      }
                      shareResults(
                        viewingQuestion.id,
                        viewingResponses.map((response) => response.id),
                        mcqCorrectOptionIds !== undefined && mcqCorrectOptionIds.length > 0 ? mcqCorrectOptionIds : null,
                      )
                    }}
                    className="rounded border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
                  >
                    {isViewingQuestionShared ? 'Stop sharing' : 'Share'}
                  </button>
                </div>
              )}

              {/* Response viewer */}
              <div className="flex-1">
                <ResponseViewer
                  question={viewingQuestion}
                  responses={viewingResponses}
                  progress={viewingProgress}
                  annotations={annotations}
                  orderOverrides={viewingOrderOverrides}
                  activeSharedResponseId={activeSharedResponseId}
                  activeReveal={isViewingQuestionShared ? activeReveal : null}
                  onAnnotate={annotateResponse}
                  onShareResponse={(responseId) => {
                    if (activeSharedResponseId === responseId) {
                      stopSharing(viewingQuestion.id)
                      return
                    }
                    shareResults(viewingQuestion.id, [responseId], null)
                  }}
                  onReorder={(orderedIds) => reorderResponses(viewingQuestion.id, orderedIds)}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
