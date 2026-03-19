import { useEffect, useId, useState, type FormEvent } from 'react'
import Button from '@src/components/ui/Button'
import type { ActivityPersistentLinkBuilderProps } from '../../../../types/activity.js'
import { runSyncDeckPresentationPreflight } from '../shared/presentationPreflight.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'

interface PersistentLinkCreateResponse {
  error?: string
  url?: string
  hash?: string
}

const MIN_TEACHER_CODE_LENGTH = 6

function formatPersistentLinkPreflightWarning(warning: string): string {
  return warning.replace(/\s*You can continue anyway\.?\s*$/i, ' Please fix the URL and verify again.')
}

function getWindowOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function readSelectedPresentationUrl(value: Record<string, unknown> | null | undefined): string {
  const presentationUrl = typeof value?.presentationUrl === 'string' ? value.presentationUrl.trim() : ''
  return presentationUrl
}

export function resolveSyncDeckPersistentLinkBuilderRequest(params: {
  activityId: string
  normalizedTeacherCode: string
  normalizedPresentationUrl: string
  editState: ActivityPersistentLinkBuilderProps['editState']
}): {
  endpoint: string
  body: Record<string, unknown>
} {
  const normalizedExistingTeacherCode = typeof params.editState?.teacherCode === 'string'
    ? params.editState.teacherCode.trim()
    : ''
  const hasKnownExistingTeacherCode = normalizedExistingTeacherCode.length > 0
  const shouldCreateNewLink = Boolean(params.editState?.hash)
    && hasKnownExistingTeacherCode
    && params.normalizedTeacherCode !== normalizedExistingTeacherCode

  if (params.editState?.hash && !shouldCreateNewLink) {
    return {
      endpoint: '/api/persistent-session/update',
      body: {
        activityName: params.activityId,
        hash: params.editState.hash,
        teacherCode: params.normalizedTeacherCode,
        entryPolicy: params.editState.entryPolicy ?? 'instructor-required',
        selectedOptions: {
          presentationUrl: params.normalizedPresentationUrl,
        },
      },
    }
  }

  return {
    endpoint: '/api/persistent-session/create',
    body: {
      activityName: params.activityId,
      teacherCode: params.normalizedTeacherCode,
      entryPolicy: 'instructor-required',
      selectedOptions: {
        presentationUrl: params.normalizedPresentationUrl,
      },
    },
  }
}

interface SyncDeckPersistentLinkBuilderComponentProps extends ActivityPersistentLinkBuilderProps {
  preflightRunner?: typeof runSyncDeckPresentationPreflight
}

export default function SyncDeckPersistentLinkBuilder({
  activityId,
  editState,
  onCreated,
  preflightRunner = runSyncDeckPresentationPreflight,
}: SyncDeckPersistentLinkBuilderComponentProps) {
  const teacherCodeInputId = useId()
  const presentationUrlInputId = useId()
  const isEditing = Boolean(editState?.hash)
  const editTeacherCode = editState?.teacherCode ?? ''
  const editPresentationUrl = readSelectedPresentationUrl(editState?.selectedOptions)
  const editEntryPolicy = editState?.entryPolicy ?? null
  const [teacherCode, setTeacherCode] = useState(editState?.teacherCode ?? '')
  const [presentationUrl, setPresentationUrl] = useState(() => readSelectedPresentationUrl(editState?.selectedOptions))
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isPreflightChecking, setIsPreflightChecking] = useState(false)
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null)
  const [preflightPreviewUrl, setPreflightPreviewUrl] = useState<string | null>(null)
  const [preflightValidatedUrl, setPreflightValidatedUrl] = useState<string | null>(null)

  useEffect(() => {
    setTeacherCode(editTeacherCode)
    setPresentationUrl(editPresentationUrl)
    setError(null)
    setIsCreating(false)
    setIsPreflightChecking(false)
    setPreflightWarning(null)
    setPreflightPreviewUrl(null)
    setPreflightValidatedUrl(null)
  }, [editEntryPolicy, editPresentationUrl, editState?.hash, editTeacherCode])

  const normalizedPresentationUrl = presentationUrl.trim()
  const normalizedTeacherCode = teacherCode.trim()
  const normalizedExistingTeacherCode = typeof editState?.teacherCode === 'string' ? editState.teacherCode.trim() : ''
  const createsNewLinkFromTeacherCodeChange = isEditing
    && normalizedTeacherCode !== normalizedExistingTeacherCode
  const presentationUrlError =
    normalizedPresentationUrl.length === 0
      ? 'Presentation URL is required'
      : getStudentPresentationCompatibilityError({
        value: normalizedPresentationUrl,
        hostProtocol: typeof window !== 'undefined' ? window.location.protocol : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
  const isUrlVerified = preflightValidatedUrl === normalizedPresentationUrl && !presentationUrlError
  const canVerify = Boolean(normalizedPresentationUrl) && !presentationUrlError && !isPreflightChecking
  const canSubmit = normalizedTeacherCode.length >= MIN_TEACHER_CODE_LENGTH && !presentationUrlError && isUrlVerified

  const buttonLabel = isCreating
    ? (createsNewLinkFromTeacherCodeChange || !isEditing ? 'Creating...' : 'Saving...')
    : (createsNewLinkFromTeacherCodeChange ? 'Create New Link' : (isEditing ? 'Save Changes' : 'Generate Link'))

  const handleVerifyUrl = async (): Promise<void> => {
    if (!canVerify) {
      return
    }

    setError(null)
    setIsPreflightChecking(true)
    try {
      const preflightResult = await preflightRunner(normalizedPresentationUrl)
      if (preflightResult.valid) {
        setPreflightValidatedUrl(normalizedPresentationUrl)
        setPreflightWarning(null)
        setPreflightPreviewUrl(normalizedPresentationUrl)
        return
      }

      setPreflightValidatedUrl(null)
      setPreflightPreviewUrl(null)
      setPreflightWarning(
        preflightResult.warning
          ? formatPersistentLinkPreflightWarning(preflightResult.warning)
          : 'Unable to verify this presentation URL right now. Please try again.',
      )
    } catch {
      setPreflightValidatedUrl(null)
      setPreflightPreviewUrl(null)
      setPreflightWarning('Unable to verify this presentation URL right now. Please try again.')
    } finally {
      setIsPreflightChecking(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!canSubmit) {
      setError(
        presentationUrlError
          ?? (normalizedTeacherCode.length < MIN_TEACHER_CODE_LENGTH
            ? `Teacher code must be at least ${MIN_TEACHER_CODE_LENGTH} characters`
            : 'Verify the presentation URL before creating the link.'),
      )
      return
    }

    setError(null)
    setIsCreating(true)

    try {
      const request = resolveSyncDeckPersistentLinkBuilderRequest({
        activityId,
        normalizedTeacherCode,
        normalizedPresentationUrl,
        editState,
      })

      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      })

      if (!response.ok) {
        let message = 'Failed to create persistent link'
        try {
          const payload = (await response.json()) as PersistentLinkCreateResponse
          if (payload.error) {
            message = payload.error
          }
        } catch {
          // Keep fallback message.
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as PersistentLinkCreateResponse
      if (!payload.url || !payload.hash) {
        throw new Error('Failed to create persistent link')
      }

      const fullUrl = /^https?:\/\//i.test(payload.url) ? payload.url : `${getWindowOrigin()}${payload.url}`
      await onCreated({
        fullUrl,
        hash: payload.hash,
        teacherCode: normalizedTeacherCode,
        selectedOptions: {
          presentationUrl: normalizedPresentationUrl,
        },
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setIsCreating(false)
      setIsPreflightChecking(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-gray-700">
        {isEditing
          ? 'Update this permanent SyncDeck link. If you change the teacher code, a new permanent link is created and the existing link remains unchanged.'
          : 'Create a permanent URL that you can use in presentations or bookmark. When anyone visits this URL, they\'ll wait until you start the session with your teacher code.'}
      </p>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
        <p className="text-sm text-yellow-800">
          <strong>⚠️ Security Note:</strong> This is for convenience, not security. The teacher code is stored in
          your browser cookies and is not encrypted. Do not use sensitive passwords.
        </p>
      </div>

      <div>
        <label htmlFor={teacherCodeInputId} className="block text-sm font-semibold text-gray-700 mb-2">Teacher Code (min. 6 characters)</label>
        <input
          id={teacherCodeInputId}
          type="text"
          value={teacherCode}
          onChange={(event) => setTeacherCode(event.target.value)}
          className="border-2 border-gray-300 rounded px-4 py-2 w-full focus:outline-none focus:border-blue-500"
          placeholder={isEditing ? 'Keep code to update this link, or enter a new code to create a new link' : 'Create a Teacher Code for this link'}
          minLength={MIN_TEACHER_CODE_LENGTH}
          required
          autoComplete="off"
        />
        <p className="text-xs text-gray-500 mt-1">
          {isEditing
            ? 'Changing the teacher code creates a new permanent link hash. Existing links are not replaced.'
            : 'Remember this code! You&apos;ll need it to start sessions from this link.'}
        </p>
      </div>

      <div>
        <label htmlFor={presentationUrlInputId} className="block text-sm font-semibold text-gray-700 mb-2">Presentation URL</label>
        <div className="flex items-center gap-2">
          <input
            id={presentationUrlInputId}
            type="text"
            value={presentationUrl}
            onChange={(event) => {
              const nextValue = event.target.value
              setPresentationUrl(nextValue)
              const normalizedNextValue = nextValue.trim()
              if (normalizedNextValue !== preflightValidatedUrl) {
                setPreflightValidatedUrl(null)
                setPreflightPreviewUrl(null)
                setPreflightWarning(null)
              }
              setError(null)
            }}
            className={`flex-1 border-2 rounded px-3 py-2 ${presentationUrlError ? 'border-red-400' : 'border-gray-300'}`}
            placeholder="https://..."
            autoComplete="off"
            required
          />
          <Button
            type="button"
            onClick={() => {
              void handleVerifyUrl()
            }}
            disabled={!canVerify || isCreating}
            variant="outline"
            className="whitespace-nowrap"
          >
            {isPreflightChecking ? 'Verifying...' : 'Verify URL'}
          </Button>
        </div>
        {!presentationUrlError && normalizedPresentationUrl && (
          <p className={`text-xs mt-1 ${isUrlVerified ? 'text-green-700' : 'text-gray-600'}`}>
            {isUrlVerified ? 'URL verified. You can now create the link.' : 'Verify this URL before creating the link.'}
          </p>
        )}
        {presentationUrlError && <p className="text-xs text-red-600 mt-1">{presentationUrlError}</p>}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}

      {preflightWarning && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 p-2 rounded">{preflightWarning}</p>
      )}

      {preflightPreviewUrl && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">Deck preview (first visible slide)</p>
          <div className="border border-gray-200 rounded overflow-hidden bg-white w-full max-w-md aspect-video">
            <iframe
              title="SyncDeck link preflight preview"
              src={preflightPreviewUrl}
              className="w-full h-full pointer-events-none"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
      )}

      <Button type="submit" disabled={isCreating || isPreflightChecking || !canSubmit}>
        {buttonLabel}
      </Button>
    </form>
  )
}
