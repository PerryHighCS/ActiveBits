import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import { consumeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import type { InstructorAnnotation, Question, ResonancePresentationMode, StagedRunState } from '../../shared/types.js'
import { useInstructorState } from '../hooks/useInstructorState.js'
import ResponseViewer from './ResponseViewer.js'
import QuestionBuilder from '../tools/QuestionBuilder.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = 'resonance_instructor_'

function getPasscode(sessionId: string): string | null {
  try {
    return typeof window === 'undefined' || window.sessionStorage == null
      ? null
      : window.sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
  } catch {
    return null
  }
}

function setStoredPasscode(sessionId: string, passcode: string): void {
  try {
    if (typeof window === 'undefined' || window.sessionStorage == null) {
      return
    }

    window.sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, passcode)
  } catch {
    // Best-effort cache only; the in-memory state still allows manager auth.
  }
}

export function resolvePasscode(sessionId: string): string | null {
  // Primary: sessionStorage key written by createSessionBootstrap config.
  const fromStorage = getPasscode(sessionId)
  if (fromStorage !== null) return fromStorage

  // Fallback: bootstrap payload stored by the parent session manager
  // (e.g. SyncDeck) after launching this activity as an embedded session.
  const bootstrap = consumeCreateSessionBootstrapPayload('resonance', sessionId)
  if (bootstrap !== null && typeof bootstrap.instructorPasscode === 'string' && bootstrap.instructorPasscode.length > 0) {
    setStoredPasscode(sessionId, bootstrap.instructorPasscode)
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

export function resolveLiveCountdown(params: {
  activeQuestionDeadlineAt: number | null
  hasLiveRun: boolean
  now: number
}): string | null {
  if (!params.hasLiveRun) {
    return null
  }

  return formatRemainingTime(params.activeQuestionDeadlineAt, params.now)
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

  return availableQuestionIds
}

export function reconcileActivationSelection(
  current: string[] | null,
  availableQuestionIds: string[],
  liveQuestionIds: string[],
): string[] {
  if (current === null) {
    return normalizeActivationSelection([], availableQuestionIds, liveQuestionIds)
  }

  const availableQuestionIdSet = new Set(availableQuestionIds)
  const next = current.filter((questionId) => availableQuestionIdSet.has(questionId))
  if (next.length === current.length && next.every((questionId, index) => questionId === current[index])) {
    return current
  }

  return next
}

export function resolveActivationSelectionForRender(
  current: string[] | null,
  availableQuestionIds: string[],
  liveQuestionIds: string[],
): string[] {
  return current ?? normalizeActivationSelection([], availableQuestionIds, liveQuestionIds)
}

export function resolveActivationSelectionAfterToggle(
  current: string[] | null,
  questionId: string,
  availableQuestionIds: string[],
  liveQuestionIds: string[],
): string[] {
  return toggleQuestionActivationSelection(
    resolveActivationSelectionForRender(current, availableQuestionIds, liveQuestionIds),
    questionId,
  )
}

export function isAllQuestionsSelected(
  selectedQuestionIds: ReadonlySet<string>,
  availableQuestionIds: readonly string[],
): boolean {
  return availableQuestionIds.length > 0 && availableQuestionIds.every((questionId) => selectedQuestionIds.has(questionId))
}

export function shouldShowQuestionListActivationControls(questionCount: number): boolean {
  return questionCount > 0
}

export function resolveManagerActiveTab(params: {
  currentActiveTab: string | null
  questions: Pick<Question, 'id'>[]
  presentationMode: ResonancePresentationMode
  stagedRun: StagedRunState | null
}): string | null {
  const questionIds = params.questions.map((question) => question.id)
  if (params.presentationMode === 'staged' && params.stagedRun?.currentQuestionId && questionIds.includes(params.stagedRun.currentQuestionId)) {
    return params.stagedRun.currentQuestionId
  }

  if (params.currentActiveTab === null && questionIds.length > 0) {
    return questionIds[0] ?? null
  }

  return params.currentActiveTab
}

export function handleQuestionListItemKeyDown(
  event: Pick<ReactKeyboardEvent<HTMLElement>, 'key' | 'preventDefault' | 'target' | 'currentTarget'>,
  onActivate: () => void,
): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  if (event.target !== event.currentTarget) {
    return
  }

  event.preventDefault()
  onActivate()
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
  const [activationSelectionIds, setActivationSelectionIds] = useState<string[] | null>(null)
  const [expandedQuestionStemIds, setExpandedQuestionStemIds] = useState<string[]>([])
  const [overflowingQuestionStemIds, setOverflowingQuestionStemIds] = useState<string[]>([])
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false)
  const [activationPresentationMode, setActivationPresentationMode] = useState<ResonancePresentationMode>('standard')
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
    if (snapshot !== null) {
      setActivationPresentationMode(snapshot.presentationMode)
    }
  }, [snapshot?.presentationMode])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  // Default active tab to the first question, and follow the current staged question as it advances.
  useEffect(() => {
    if (snapshot === null) {
      return
    }

    const nextActiveTab = resolveManagerActiveTab({
      currentActiveTab: activeTab,
      questions: snapshot.questions,
      presentationMode: snapshot.presentationMode,
      stagedRun: snapshot.stagedRun,
    })
    if (nextActiveTab !== activeTab) {
      setActiveTab(nextActiveTab)
    }
  }, [snapshot, activeTab])

  useEffect(() => {
    if (snapshot === null) {
      return
    }

    const availableIds = snapshot.questions.map((question) => question.id)
    setActivationSelectionIds((current) => {
      return reconcileActivationSelection(current, availableIds, snapshot.activeQuestionIds)
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
    (questionId: string | null) => void callInstructor('/activate-question', {
      questionId,
      presentationMode: activationPresentationMode,
    }),
    [activationPresentationMode, callInstructor],
  )

  const activateQuestions = useCallback(
    (questionIds: string[]) => void callInstructor('/activate-question', {
      questionIds,
      presentationMode: activationPresentationMode,
    }),
    [activationPresentationMode, callInstructor],
  )

  const revealChoices = useCallback(
    () => void callInstructor('/reveal-choices', {}),
    [callInstructor],
  )

  const advanceStagedQuestion = useCallback(
    () => void callInstructor('/advance-staged-question', {}),
    [callInstructor],
  )

  const toggleActivationSelection = useCallback((questionId: string) => {
    const availableQuestionIds = snapshot?.questions.map((question) => question.id) ?? []
    const liveQuestionIds = snapshot?.activeQuestionIds ?? []
    setActivationSelectionIds((current) => (
      resolveActivationSelectionAfterToggle(current, questionId, availableQuestionIds, liveQuestionIds)
    ))
  }, [snapshot])

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
    return (
      <div className="flex items-center justify-center p-8 text-slate-500 dark:text-slate-400">
        No active session.
      </div>
    )
  }

  if (isResolvingPasscode) {
    return (
      <div className="flex items-center justify-center p-8 text-slate-500 dark:text-slate-400">
        Loading instructor session…
      </div>
    )
  }

  if (passcode === null) {
    return (
      <div className="flex items-center justify-center p-8 text-slate-500 dark:text-slate-400">
        Instructor passcode not found. Try re-entering from the session creation link.
      </div>
    )
  }

  if (loading && snapshot === null) {
    return (
      <div className="flex items-center justify-center p-8 text-slate-400 dark:text-slate-500">
        Loading session…
      </div>
    )
  }

  if (error !== null && snapshot === null) {
    return (
      <div className="flex items-center justify-center p-8 text-red-600 dark:text-red-400">
        {error}
      </div>
    )
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
  const stagedRun = snapshot.stagedRun
  const isStagedRunActive = snapshot.presentationMode === 'staged' && stagedRun !== null
  const currentStagedQuestion = isStagedRunActive
    ? questions.find((question) => question.id === stagedRun.currentQuestionId) ?? null
    : null
  const questionIds = questions.map((question) => question.id)
  const resolvedActivationSelectionIds = resolveActivationSelectionForRender(
    activationSelectionIds,
    questionIds,
    activeQuestionIds,
  )
  const activationSelectionSet = new Set(resolvedActivationSelectionIds)
  const allQuestionsSelected = isAllQuestionsSelected(activationSelectionSet, questionIds)
  const expandedQuestionStemSet = new Set(expandedQuestionStemIds)
  const overflowingQuestionStemSet = new Set(overflowingQuestionStemIds)
  const liveCountdown = resolveLiveCountdown({
    activeQuestionDeadlineAt,
    hasLiveRun,
    now: countdownNow,
  })
  const activeReveal = reveals[0] ?? null

  // Question shown in the viewer panel.
  const viewingQuestion = questions.find((q) => q.id === activeTab) ?? null
  const isViewingCurrentStagedQuestion =
    isStagedRunActive && viewingQuestion?.id === stagedRun.currentQuestionId
  const canRevealCurrentStagedChoices =
    isViewingCurrentStagedQuestion &&
    viewingQuestion?.type === 'multiple-choice' &&
    stagedRun.choicesRevealed === false
  const canAdvanceCurrentStagedQuestion = isViewingCurrentStagedQuestion &&
    (viewingQuestion?.type !== 'multiple-choice' || stagedRun.choicesRevealed)

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Resonance</h1>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{sessionId.slice(0, 8)}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {students.length} student{students.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {liveCountdown !== null && activeQuestionIds.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-right">
              <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Time left</p>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{liveCountdown}</p>
            </div>
          )}
          {error !== null && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{error}</span>
          )}
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Left panel: question list */}
        <aside className="w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col overflow-y-auto">
          <div className="p-3 space-y-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
              Build
            </p>
            <div className="pb-3">
              <button
                type="button"
                aria-expanded={isAddQuestionOpen}
                aria-controls="resonance-add-question-builder"
                onClick={() => setIsAddQuestionOpen((current) => !current)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-700"
              >
                <span>{isAddQuestionOpen ? 'Hide question builder' : 'Add question'}</span>
                <span className="text-sm text-slate-400 dark:text-slate-500">{isAddQuestionOpen ? '▴' : '▾'}</span>
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

            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 border-t border-slate-200 dark:border-slate-700 pt-3">
              Questions
            </p>

            {questions.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic">No questions yet.</p>
            )}

            {shouldShowQuestionListActivationControls(questions.length) && (
              <div className="space-y-2 pb-2">
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5" aria-label="Presentation mode">
                  {(['standard', 'staged'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={activationPresentationMode === mode}
                      onClick={() => setActivationPresentationMode(mode)}
                      className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        activationPresentationMode === mode
                          ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {mode === 'standard' ? 'Standard' : 'Staged'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setActivationSelectionIds(allQuestionsSelected ? [] : questionIds)
                    }
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {allQuestionsSelected ? 'Select none' : 'Select all'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => activateQuestions(resolvedActivationSelectionIds)}
                  disabled={resolvedActivationSelectionIds.length === 0}
                  className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activationPresentationMode === 'staged' ? 'Start staged' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => activateQuestion(null)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Stop
                </button>
                </div>
              </div>
            )}

            {questions.map((q) => {
              const isActive = activeQuestionIdSet.has(q.id)
              const isSelectedForActivation = activationSelectionSet.has(q.id)
              const stagedStatus = stagedRun?.completedQuestionIds.includes(q.id)
                ? 'Done'
                : stagedRun?.currentQuestionId === q.id
                  ? q.type === 'multiple-choice' && !stagedRun.choicesRevealed
                    ? 'Stem'
                    : 'Live'
                  : isStagedRunActive && stagedRun?.questionIds.includes(q.id)
                    ? 'Queued'
                    : null
              const isStemExpanded = expandedQuestionStemSet.has(q.id)
              const isViewing = q.id === activeTab
              const responseCount = progress.filter((entry) => entry.questionId === q.id).length
              const hasReveal = reveals.some((rv) => rv.questionId === q.id)
              const canExpandStem = isStemExpanded || overflowingQuestionStemSet.has(q.id)

              return (
                <div
                  key={q.id}
                  className={`rounded-xl border px-2.5 py-2 cursor-pointer text-sm transition-colors ${
                    isViewing
                      ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                  onClick={() => setActiveTab(q.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isViewing}
                  onKeyDown={(e) => {
                    handleQuestionListItemKeyDown(e, () => setActiveTab(q.id))
                  }}
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
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        {isStemExpanded ? (
                          <div className="space-y-1">
                            <p
                              ref={(element) => {
                                questionStemRefs.current[q.id] = element
                              }}
                              className="text-xs text-slate-700 dark:text-slate-300 whitespace-normal break-words"
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
                                className="inline-flex items-center text-[10px] font-medium text-indigo-700 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
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
                              className="flex-1 overflow-hidden whitespace-nowrap text-clip text-xs text-slate-700 dark:text-slate-300"
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
                                className="shrink-0 text-[10px] font-medium leading-none text-indigo-700 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                              >
                                ...
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {stagedStatus !== null && (
                      <span className="text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 rounded-md px-1 shrink-0">
                        {stagedStatus}
                      </span>
                    )}
                    {isActive && stagedStatus === null && (
                      <span className="text-[10px] bg-indigo-500 text-white rounded-md px-1 shrink-0">
                        Live
                      </span>
                    )}
                    {hasReveal && !isActive && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        Shared
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {responseCount} resp.
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={
                          isSelectedForActivation
                            ? 'Remove question from selected activation set'
                            : 'Add question to selected activation set'
                        }
                        aria-pressed={isSelectedForActivation}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleActivationSelection(q.id)
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                          isSelectedForActivation
                            ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
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
        <main className="flex flex-1 flex-col overflow-y-auto p-5 gap-4">
          {viewingQuestion === null ? (
            <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm">
              Select a question from the left panel.
            </div>
          ) : (
            <>
              {/* Question header */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 px-5 py-4 space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {viewingQuestion.type === 'free-response' ? 'Free response' : 'Multiple choice'}
                  {activeQuestionIdSet.has(viewingQuestion.id) && (
                    <span className="ml-2 text-indigo-600 dark:text-indigo-400 font-medium">
                      ● Live
                    </span>
                  )}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {viewingQuestion.text}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {viewingResponses.length} of {students.length} responded
                  {isViewingQuestionShared && (
                    <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                      ● Results shared
                    </span>
                  )}
                  {isViewingCurrentStagedQuestion && currentStagedQuestion !== null && (
                    <span className="ml-2 text-rose-600 dark:text-rose-400">
                      ● Staged {stagedRun.currentIndex + 1} of {stagedRun.questionIds.length}
                    </span>
                  )}
                </p>
                {isViewingCurrentStagedQuestion && (
                  <div className="pt-2">
                    {canRevealCurrentStagedChoices ? (
                      <button
                        type="button"
                        onClick={revealChoices}
                        className="rounded-xl bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 transition-colors"
                      >
                        Reveal choices
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={advanceStagedQuestion}
                        disabled={!canAdvanceCurrentStagedQuestion}
                        className="rounded-xl border border-rose-300 dark:border-rose-600 px-3 py-1.5 text-sm font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {stagedRun.currentIndex + 1 >= stagedRun.questionIds.length ? 'End staged run' : 'Next question'}
                      </button>
                    )}
                  </div>
                )}
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
                        mcqCorrectOptionIds !== undefined && mcqCorrectOptionIds.length > 0
                          ? mcqCorrectOptionIds
                          : null,
                      )
                    }}
                    className="rounded-xl border border-indigo-300 dark:border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
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
