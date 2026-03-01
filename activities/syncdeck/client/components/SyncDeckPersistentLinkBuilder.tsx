import { useMemo, useState, type FormEvent } from 'react'
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

function getWindowOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export default function SyncDeckPersistentLinkBuilder({ activityId, onCreated }: ActivityPersistentLinkBuilderProps) {
  const [teacherCode, setTeacherCode] = useState('')
  const [presentationUrl, setPresentationUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isPreflightChecking, setIsPreflightChecking] = useState(false)
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null)
  const [preflightPreviewUrl, setPreflightPreviewUrl] = useState<string | null>(null)
  const [preflightValidatedUrl, setPreflightValidatedUrl] = useState<string | null>(null)
  const [allowUnverifiedGenerateForUrl, setAllowUnverifiedGenerateForUrl] = useState<string | null>(null)
  const [confirmGenerateForUrl, setConfirmGenerateForUrl] = useState<string | null>(null)

  const normalizedPresentationUrl = presentationUrl.trim()
  const normalizedTeacherCode = teacherCode.trim()
  const presentationUrlError =
    normalizedPresentationUrl.length === 0
      ? 'Presentation URL is required'
      : getStudentPresentationCompatibilityError({
        value: normalizedPresentationUrl,
        hostProtocol: typeof window !== 'undefined' ? window.location.protocol : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
  const canSubmit = normalizedTeacherCode.length >= MIN_TEACHER_CODE_LENGTH && !presentationUrlError

  const showGenerateAnyway =
    Boolean(preflightWarning) &&
    Boolean(normalizedPresentationUrl) &&
    allowUnverifiedGenerateForUrl === normalizedPresentationUrl
  const showGenerateVerified =
    preflightValidatedUrl === normalizedPresentationUrl &&
    confirmGenerateForUrl === normalizedPresentationUrl

  const buttonLabel = useMemo(() => {
    if (isPreflightChecking) return 'Validating...'
    if (isCreating) return 'Creating...'
    if (showGenerateAnyway) return 'Generate Anyway'
    if (showGenerateVerified) return 'Generate Verified Link'
    return 'Generate Link'
  }, [isCreating, isPreflightChecking, showGenerateAnyway, showGenerateVerified])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!canSubmit) {
      setError(presentationUrlError ?? `Teacher code must be at least ${MIN_TEACHER_CODE_LENGTH} characters`)
      return
    }

    setError(null)
    setIsCreating(true)

    try {
      const canBypassPreflight = allowUnverifiedGenerateForUrl === normalizedPresentationUrl
      if (preflightValidatedUrl !== normalizedPresentationUrl && !canBypassPreflight) {
        setIsPreflightChecking(true)
        const preflightResult = await runSyncDeckPresentationPreflight(normalizedPresentationUrl)
        setIsPreflightChecking(false)

        if (preflightResult.valid) {
          setPreflightValidatedUrl(normalizedPresentationUrl)
          setAllowUnverifiedGenerateForUrl(null)
          setConfirmGenerateForUrl(normalizedPresentationUrl)
          setPreflightWarning(null)
          setPreflightPreviewUrl(normalizedPresentationUrl)
          return
        }

        setPreflightValidatedUrl(null)
        setPreflightPreviewUrl(null)
        setPreflightWarning(preflightResult.warning)
        setAllowUnverifiedGenerateForUrl(normalizedPresentationUrl)
        setConfirmGenerateForUrl(null)
        setError('Link validation failed. Click Generate Anyway to continue.')
        return
      }

      if (preflightValidatedUrl === normalizedPresentationUrl && confirmGenerateForUrl === normalizedPresentationUrl) {
        setConfirmGenerateForUrl(null)
      }

      const response = await fetch('/api/syncdeck/generate-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityName: activityId,
          teacherCode: normalizedTeacherCode,
          selectedOptions: {
            presentationUrl: normalizedPresentationUrl,
          },
        }),
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
        Create a permanent URL that you can use in presentations or bookmark. When anyone visits this URL,
        they&apos;ll wait until you start the session with your teacher code.
      </p>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
        <p className="text-sm text-yellow-800">
          <strong>⚠️ Security Note:</strong> This is for convenience, not security. The teacher code is stored in
          your browser cookies and is not encrypted. Do not use sensitive passwords.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Teacher Code (min. 6 characters)</label>
        <input
          type="text"
          value={teacherCode}
          onChange={(event) => setTeacherCode(event.target.value)}
          className="border-2 border-gray-300 rounded px-4 py-2 w-full focus:outline-none focus:border-blue-500"
          placeholder="Create a Teacher Code for this link"
          minLength={MIN_TEACHER_CODE_LENGTH}
          required
          autoComplete="off"
        />
        <p className="text-xs text-gray-500 mt-1">Remember this code! You&apos;ll need it to start sessions from this link.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Presentation URL</label>
        <input
          type="text"
          value={presentationUrl}
          onChange={(event) => {
            const nextValue = event.target.value
            setPresentationUrl(nextValue)
            const normalizedNextValue = nextValue.trim()
            if (!normalizedNextValue || normalizedNextValue === preflightValidatedUrl) {
              return
            }
            setPreflightValidatedUrl(null)
            setPreflightPreviewUrl(null)
            setPreflightWarning(null)
            setAllowUnverifiedGenerateForUrl(null)
            setConfirmGenerateForUrl(null)
          }}
          className={`w-full border-2 rounded px-3 py-2 ${presentationUrlError ? 'border-red-400' : 'border-gray-300'}`}
          placeholder="https://..."
          autoComplete="off"
          required
        />
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
