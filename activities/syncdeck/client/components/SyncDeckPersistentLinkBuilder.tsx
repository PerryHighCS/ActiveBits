import { useEffect, useId, useState, type ChangeEvent } from 'react'
import Button from '@src/components/ui/Button'
import type { ActivityPersistentLinkBuilderProps } from '../../../../types/activity.js'
import { runSyncDeckPresentationPreflight } from '../shared/presentationPreflight.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'

function formatPersistentLinkPreflightWarning(warning: string): string {
  return warning.replace(/\s*You can continue anyway\.?\s*$/i, ' Please fix the URL and verify again.')
}

function readSelectedPresentationUrl(value: Record<string, unknown> | null | undefined): string {
  return typeof value?.presentationUrl === 'string' ? value.presentationUrl.trim() : ''
}

interface SyncDeckPersistentLinkBuilderComponentProps extends ActivityPersistentLinkBuilderProps {
  preflightRunner?: typeof runSyncDeckPresentationPreflight
}

export default function SyncDeckPersistentLinkBuilder({
  editState,
  selectedOptions,
  onSelectedOptionsChange,
  onSubmitReadinessChange,
  onCreated: _onCreated,
  preflightRunner = runSyncDeckPresentationPreflight,
}: SyncDeckPersistentLinkBuilderComponentProps) {
  const presentationUrlInputId = useId()
  const isEditing = Boolean(editState?.hash)
  const editPresentationUrl = readSelectedPresentationUrl(editState?.selectedOptions)
  const controlledPresentationUrl = typeof selectedOptions?.presentationUrl === 'string'
    ? selectedOptions.presentationUrl
    : editPresentationUrl
  const [presentationUrl, setPresentationUrl] = useState(controlledPresentationUrl)
  const [isPreflightChecking, setIsPreflightChecking] = useState(false)
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null)
  const [preflightPreviewUrl, setPreflightPreviewUrl] = useState<string | null>(null)
  const [preflightValidatedUrl, setPreflightValidatedUrl] = useState<string | null>(null)

  useEffect(() => {
    setPresentationUrl(controlledPresentationUrl)
  }, [controlledPresentationUrl])

  useEffect(() => {
    onSelectedOptionsChange?.({
      presentationUrl,
    })
  }, [onSelectedOptionsChange, presentationUrl])

  const normalizedPresentationUrl = presentationUrl.trim()
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

  useEffect(() => {
    onSubmitReadinessChange?.(isUrlVerified)
  }, [isUrlVerified, onSubmitReadinessChange])

  const handleVerifyUrl = async (): Promise<void> => {
    if (!canVerify) {
      return
    }

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

  const handlePresentationUrlChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextValue = event.target.value
    setPresentationUrl(nextValue)
    if (nextValue.trim() !== preflightValidatedUrl) {
      setPreflightValidatedUrl(null)
      setPreflightPreviewUrl(null)
      setPreflightWarning(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-gray-700">
        {isEditing
          ? 'Update this permanent SyncDeck link. Verify the presentation again after changing the deck URL.'
          : 'Choose a presentation URL and verify it before generating the permanent SyncDeck link.'}
      </p>

      <div>
        <label htmlFor={presentationUrlInputId} className="block text-sm font-semibold text-gray-700 mb-2">Presentation URL</label>
        <div className="flex items-center gap-2">
          <input
            id={presentationUrlInputId}
            type="text"
            value={presentationUrl}
            onChange={handlePresentationUrlChange}
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
            disabled={!canVerify}
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
    </div>
  )
}
