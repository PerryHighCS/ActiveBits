import { useEffect, useState } from 'react'
import type { ActivityPersistentLinkBuilderProps } from '../../../../types/activity.js'
import type { Question } from '../../shared/types.js'
import { validateQuestionSet } from '../../shared/validation.js'
import { cacheResonanceQuestionDraft, loadResonanceQuestionDraft } from './resonanceQuestionDraftCache.js'
import ResonanceQuestionSetUploader from './ResonanceQuestionSetUploader.js'

interface PrepareLinkOptionsResponse {
  selectedOptions?: {
    q?: string
    h?: string
  }
  error?: string
  details?: string[]
}

const PREPARE_LINK_OPTIONS_DEBOUNCE_MS = 500

export function normalizeEditStateQuestions(rawSavedQuestions: unknown): Question[] | null {
  const { questions, errors } = validateQuestionSet(rawSavedQuestions)
  if (errors.length > 0 || questions.length === 0) return null
  return questions
}

/**
 * Activity-owned persistent-link builder for Resonance.
 *
 * Accepts a JSON or Gimkit CSV question set, validates it client-side,
 * posts to /api/resonance/prepare-link-options for server-side validation and
 * encryption, then hands prepared `selectedOptions` back to the shared dashboard.
 *
 * Supports both create-mode (no editState) and edit-mode (editState provided).
 * In edit mode the teacher code is pre-filled and questions are recovered from
 * a local cache keyed by persistent-link hash.
 */
export default function ResonancePersistentLinkBuilder({
  activityId: _activityId,
  teacherCode = '',
  selectedOptions,
  editState,
  onSelectedOptionsChange,
  onSubmitReadinessChange,
}: ActivityPersistentLinkBuilderProps) {
  // Backward compatibility for legacy builder state while preferring local cache.
  const rawSavedQuestions = editState?.selectedOptions?.questions
  const savedQuestionsFromEditState = normalizeEditStateQuestions(rawSavedQuestions)
  const cachedQuestions = typeof editState?.selectedOptions?.h === 'string'
    ? loadResonanceQuestionDraft(editState.selectedOptions.h)
    : (editState?.hash ? loadResonanceQuestionDraft(editState.hash) : null)
  const savedQuestions = savedQuestionsFromEditState ?? cachedQuestions

  const [questions, setQuestions] = useState<Question[] | null>(savedQuestions)
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [preparedHash, setPreparedHash] = useState<string | null>(
    typeof selectedOptions?.h === 'string' ? selectedOptions.h : null,
  )

  const isEdit = Boolean(editState)
  const normalizedTeacherCode = teacherCode.trim()
  const canPrepare = normalizedTeacherCode.length >= 6 && questions !== null && questions.length > 0

  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()

    if (!canPrepare || questions === null) {
      setPreparing(false)
      setPrepareError(null)
      setPreparedHash(null)
      onSelectedOptionsChange?.({})
      onSubmitReadinessChange?.(false)
      return () => {
        cancelled = true
      }
    }

    onSubmitReadinessChange?.(false)
    setPreparing(true)
    setPrepareError(null)

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const resp = await fetch('/api/resonance/prepare-link-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacherCode: normalizedTeacherCode, questions }),
            signal: abortController.signal,
          })

          const data = (await resp.json()) as PrepareLinkOptionsResponse
          const preparedSelectedOptions = data.selectedOptions
          const preparedHashValue = typeof preparedSelectedOptions?.h === 'string' ? preparedSelectedOptions.h : null
          const preparedQuestionPayload = typeof preparedSelectedOptions?.q === 'string' ? preparedSelectedOptions.q : null

          if (!resp.ok || !preparedHashValue || !preparedQuestionPayload) {
            throw new Error(data.error ?? 'Failed to prepare link options — please try again')
          }

          if (cancelled) {
            return
          }

          cacheResonanceQuestionDraft(preparedHashValue, questions)
          setPreparedHash(preparedHashValue)
          setPrepareError(null)
          onSelectedOptionsChange?.({
            q: preparedQuestionPayload,
            h: preparedHashValue,
          })
          onSubmitReadinessChange?.(true)
        } catch (error) {
          if (cancelled) {
            return
          }
          if ((error instanceof DOMException && error.name === 'AbortError') || abortController.signal.aborted) {
            return
          }

          setPreparedHash(null)
          setPrepareError(error instanceof Error ? error.message : 'Failed to prepare link options — please try again')
          onSelectedOptionsChange?.({})
          onSubmitReadinessChange?.(false)
        } finally {
          if (!cancelled) {
            setPreparing(false)
          }
        }
      })()
    }, PREPARE_LINK_OPTIONS_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [canPrepare, normalizedTeacherCode, onSelectedOptionsChange, onSubmitReadinessChange, questions])

  return (
    <div className="space-y-5 p-1" aria-label={isEdit ? 'Update Resonance persistent link' : 'Create Resonance persistent link'}>
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-1" id="resonance-plb-file-label">
          Question set
        </p>
        <ResonanceQuestionSetUploader
          onQuestionsChanged={setQuestions}
          initialQuestions={savedQuestions}
        />
      </div>

      {normalizedTeacherCode.length > 0 && normalizedTeacherCode.length < 6 && (
        <p className="text-sm text-amber-700" role="status">
          Teacher code must be at least 6 characters before Resonance can prepare the link payload.
        </p>
      )}

      {prepareError && (
        <p className="text-sm text-red-600" role="alert">
          {prepareError}
        </p>
      )}

      {!prepareError && canPrepare && preparing && (
        <p className="text-sm text-gray-600" role="status">
          Preparing encrypted question payload…
        </p>
      )}

      {!prepareError && !preparing && preparedHash && (
        <p className="text-sm text-green-700" role="status">
          Question set ready. You can now {isEdit ? 'save' : 'generate'} the link.
        </p>
      )}
    </div>
  )
}
