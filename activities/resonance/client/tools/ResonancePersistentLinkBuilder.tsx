import { useState } from 'react'
import type { SubmitEvent } from 'react'
import type { ActivityPersistentLinkBuilderProps } from '../../../../types/activity.js'
import type { Question } from '../../shared/types.js'
import { cacheResonanceQuestionDraft, loadResonanceQuestionDraft } from './resonanceQuestionDraftCache.js'
import ResonanceQuestionSetUploader from './ResonanceQuestionSetUploader.js'

interface GenerateLinkResponse {
  hash?: string
  url?: string
  error?: string
  details?: string[]
}

/**
 * Activity-owned persistent-link builder for Resonance.
 *
 * Accepts a JSON or Gimkit CSV question set, validates it client-side,
 * posts to /api/resonance/generate-link for server-side validation and
 * encryption, then calls onCreated with the authoritative result.
 *
 * Supports both create-mode (no editState) and edit-mode (editState provided).
 * In edit mode the teacher code is pre-filled and questions are recovered from
 * a local cache keyed by persistent-link hash.
 */
export default function ResonancePersistentLinkBuilder({
  activityId: _activityId,
  editState,
  onCreated,
}: ActivityPersistentLinkBuilderProps) {
  // Backward compatibility for legacy builder state while preferring local cache.
  const rawSavedQuestions = editState?.selectedOptions?.questions
  const savedQuestionsFromEditState: Question[] | null =
    Array.isArray(rawSavedQuestions) && rawSavedQuestions.length > 0
      ? (rawSavedQuestions as Question[])
      : null
  const cachedQuestions = editState?.hash ? loadResonanceQuestionDraft(editState.hash) : null
  const savedQuestions = savedQuestionsFromEditState ?? cachedQuestions

  const [teacherCode, setTeacherCode] = useState(editState?.teacherCode ?? '')
  const [questions, setQuestions] = useState<Question[] | null>(savedQuestions)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isEdit = Boolean(editState)
  const canSubmit = !submitting && teacherCode.trim().length >= 6 && questions !== null && questions.length > 0

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit || questions === null) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const resp = await fetch('/api/resonance/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherCode: teacherCode.trim(), questions }),
      })

      const data = (await resp.json()) as GenerateLinkResponse

      if (!resp.ok || !data.hash || !data.url) {
        setSubmitError(data.error ?? 'Failed to generate link — please try again')
        setSubmitting(false)
        return
      }

      const fullUrl = /^https?:\/\//i.test(data.url)
        ? data.url
        : `${window.location.origin}${data.url}`

      cacheResonanceQuestionDraft(data.hash, questions)

      await onCreated({
        fullUrl,
        hash: data.hash,
        teacherCode: teacherCode.trim(),
      })
    } catch {
      setSubmitError('Network error — please check your connection and try again')
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="space-y-5 p-1"
      aria-label={isEdit ? 'Update Resonance persistent link' : 'Create Resonance persistent link'}
    >
      {/* Teacher code */}
      <div>
        <label
          htmlFor="resonance-plb-teacher-code"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Teacher code
        </label>
        <input
          id="resonance-plb-teacher-code"
          type="text"
          value={teacherCode}
          onChange={(e) => setTeacherCode(e.target.value)}
          placeholder="Minimum 6 characters"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-describedby="resonance-plb-teacher-code-hint"
          disabled={submitting}
        />
        <p id="resonance-plb-teacher-code-hint" className="mt-0.5 text-xs text-gray-500">
          Proves you own this session. Keep it private — you can re-enter your session with it.
        </p>
      </div>

      {/* Question set upload */}
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-1" id="resonance-plb-file-label">
          Question set
        </p>
        <ResonanceQuestionSetUploader
          onQuestionsChanged={setQuestions}
          initialQuestions={savedQuestions}
        />
      </div>

      {/* Submit error */}
      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        aria-busy={submitting}
        aria-disabled={!canSubmit}
        className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? isEdit
            ? 'Updating link…'
            : 'Generating link…'
          : isEdit
            ? 'Update link'
            : 'Generate link'}
      </button>
    </form>
  )
}
