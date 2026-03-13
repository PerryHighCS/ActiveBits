import { useEffect, useRef, useState, type ChangeEvent, type ComponentType, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  WaitingRoomFieldConfig,
  WaitingRoomFieldComponentProps,
  WaitingRoomSerializableValue,
} from '../../../../types/waitingRoom.js'
import Button from '../ui/Button'
import { getActivity, loadActivityWaitingRoomFields } from '@src/activities'
import { getPersistentSelectedOptionsFromSearchForActivity } from './sessionRouterUtils'
import {
  buildWaitingRoomStorageKey,
  getWaitingRoomInitialValues,
  persistWaitingRoomValues,
  readWaitingRoomValues,
  validateWaitingRoomValues,
  type WaitingRoomFieldValueMap,
} from './waitingRoomFormUtils'
import {
  buildPersistentAuthenticateApiUrl,
  buildPersistentTeacherCodeApiUrl,
  buildPersistentSessionWsUrl,
  getWaiterMessage,
  isWaitingRoomMessage,
  parseWaitingRoomMessage,
  type WaitingRoomMessage,
} from './waitingRoomUtils'
import { getCustomFieldStatus } from './waitingRoomFieldUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'
import { getWaitingRoomViewModel } from './waitingRoomViewUtils'
import { resolvePersistentSessionAuthFailure, type PersistentSessionAuthErrorResponse } from './persistentSessionAuthUtils'

interface WaitingRoomProps {
  activityName: string
  hash: string
  hasTeacherCookie: boolean
  entryOutcome?: PersistentSessionEntryOutcome
  entryPolicy?: PersistentSessionEntryPolicy
  startedSessionId?: string
  allowTeacherSection?: boolean
  showShareUrl?: boolean
  onJoinLive?: () => void
}

interface TeacherAuthenticateResponse extends PersistentSessionAuthErrorResponse {
  isStarted?: boolean
  sessionId?: string | null
}

const EMPTY_WAITING_ROOM_FIELDS: readonly WaitingRoomFieldConfig[] = []
const EMPTY_CUSTOM_FIELD_COMPONENTS: Record<string, ComponentType<WaitingRoomFieldComponentProps>> = {}

function getFieldLabel(field: WaitingRoomFieldConfig): string {
  return field.label?.trim() || field.id
}

function toFieldStringValue(value: WaitingRoomSerializableValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * WaitingRoom component for persistent sessions
 * Shows waiting students count and allows teacher to enter code to start session.
 */
export default function WaitingRoom({
  activityName,
  hash,
  hasTeacherCookie,
  entryOutcome = 'wait',
  entryPolicy,
  startedSessionId,
  allowTeacherSection = true,
  showShareUrl = true,
  onJoinLive,
}: WaitingRoomProps) {
  const activity = getActivity(activityName)
  const waitingRoomFields = activity?.waitingRoom?.fields ?? EMPTY_WAITING_ROOM_FIELDS
  const [waiterCount, setWaiterCount] = useState(0)
  const [teacherCode, setTeacherCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [waitingRoomValues, setWaitingRoomValues] = useState<WaitingRoomFieldValueMap>({})
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({})
  const [customFieldComponents, setCustomFieldComponents] = useState<Record<string, ComponentType<WaitingRoomFieldComponentProps>>>(EMPTY_CUSTOM_FIELD_COMPONENTS)
  const [customFieldLoadError, setCustomFieldLoadError] = useState<string | null>(null)
  const shouldAutoAuthRef = useRef(hasTeacherCookie)
  const hasNavigatedRef = useRef(false)
  const teacherAuthRequestedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const navigate = useNavigate()
  const isWaitingForTeacher = entryOutcome === 'wait'

  useEffect(() => {
    shouldAutoAuthRef.current = hasTeacherCookie && entryPolicy !== 'solo-only'
  }, [entryPolicy, hasTeacherCookie])

  useEffect(() => {
    const storageKey = buildWaitingRoomStorageKey(activityName, hash)
    const storedValues = typeof window !== 'undefined' && window.sessionStorage != null
      ? readWaitingRoomValues(window.sessionStorage, storageKey, waitingRoomFields)
      : null

    setWaitingRoomValues(getWaitingRoomInitialValues(waitingRoomFields, storedValues))
    setTouchedFields({})
  }, [activityName, hash, waitingRoomFields])

  useEffect(() => {
    if (typeof window === 'undefined' || window.sessionStorage == null) {
      return
    }

    const storageKey = buildWaitingRoomStorageKey(activityName, hash)
    if (waitingRoomFields.length === 0) {
      window.sessionStorage.removeItem(storageKey)
      return
    }

    persistWaitingRoomValues(window.sessionStorage, storageKey, waitingRoomFields, waitingRoomValues)
  }, [activityName, hash, waitingRoomFields, waitingRoomValues])

  useEffect(() => {
    const hasCustomFields = waitingRoomFields.some((field) => field.type === 'custom')
    if (!hasCustomFields) {
      setCustomFieldComponents(EMPTY_CUSTOM_FIELD_COMPONENTS)
      setCustomFieldLoadError(null)
      return
    }

    let isCancelled = false
    setCustomFieldLoadError(null)

    void loadActivityWaitingRoomFields(activityName)
      .then((loadedFields) => {
        if (!isCancelled) {
          setCustomFieldComponents(loadedFields)
        }
      })
      .catch((error) => {
        console.error('[WaitingRoom] Failed to load custom waiting-room fields:', error)
        if (!isCancelled) {
          setCustomFieldComponents(EMPTY_CUSTOM_FIELD_COMPONENTS)
          setCustomFieldLoadError('Custom waiting-room fields are unavailable right now.')
        }
      })

    return () => {
      isCancelled = true
    }
  }, [activityName, waitingRoomFields])

  useEffect(() => {
    setError(null)
    teacherAuthRequestedRef.current = false

    if (!isWaitingForTeacher) {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        wsRef.current.close()
      }
      wsRef.current = null
      return undefined
    }

    if (typeof window === 'undefined') {
      return undefined
    }

    const wsUrl = buildPersistentSessionWsUrl(window.location, hash, activityName)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    const navigateOnce = (path: string) => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      void navigate(path)
    }

    ws.onopen = () => {
      setError(null)

      if (shouldAutoAuthRef.current) {
        fetch(buildPersistentTeacherCodeApiUrl(hash, activityName), {
          credentials: 'include',
        })
          .then((response) => response.json())
          .then((data: { teacherCode?: string }) => {
            if (!data.teacherCode) return

            try {
              ws.send(
                JSON.stringify({
                  type: 'verify-teacher-code',
                  teacherCode: data.teacherCode,
                }),
              )
            } catch (sendError) {
              console.error('Failed to send teacher code over WS:', sendError)
            }
          })
          .catch((fetchError) => console.error('Failed to fetch teacher code:', fetchError))
      }
    }

    ws.onmessage = (event) => {
      const rawMessage = parseWaitingRoomMessage(String(event.data))
      if (!rawMessage) {
        console.error('Failed to parse WebSocket message:', event.data)
        return
      }
      if (!isWaitingRoomMessage(rawMessage)) {
        return
      }

      if (hasNavigatedRef.current) {
        return
      }

      const queryString = typeof window !== 'undefined' ? window.location.search : ''
      handleWaitingRoomMessage({
        message: rawMessage,
        setWaiterCount,
        setError,
        setIsSubmitting,
        teacherAuthRequestedRef,
        navigateOnce,
        activityName,
        queryString,
      })
    }

    ws.onerror = () => {
      if (hasNavigatedRef.current) return
      setError('Connection error.')
    }

    ws.onclose = () => {
      if (hasNavigatedRef.current) return
      setError('Connection closed.')
    }

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close()
      }
    }
  }, [activityName, hash, isWaitingForTeacher, navigate])

  const waitingRoomErrors = validateWaitingRoomValues(waitingRoomFields, waitingRoomValues)
  const viewModel = getWaitingRoomViewModel(entryOutcome)

  const handleTeacherCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    teacherAuthRequestedRef.current = true

    const normalizedTeacherCode = teacherCode.trim()

    try {
      const queryString = typeof window !== 'undefined' ? window.location.search : ''
      const selectedOptions = getPersistentSelectedOptionsFromSearchForActivity(
        queryString,
        activity?.deepLinkOptions,
        activityName,
      )

      const authenticateResponse = await fetch(buildPersistentAuthenticateApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          activityName,
          hash,
          teacherCode: normalizedTeacherCode,
          selectedOptions,
        }),
      })

      if (!authenticateResponse.ok) {
        const payload = (await authenticateResponse.json().catch(() => ({}))) as TeacherAuthenticateResponse
        throw new Error(resolvePersistentSessionAuthFailure(payload).message)
      }

      const payload = (await authenticateResponse.json()) as TeacherAuthenticateResponse
      if (payload.isStarted && typeof payload.sessionId === 'string' && payload.sessionId.length > 0) {
        const queryString = typeof window !== 'undefined' ? window.location.search : ''
        const teacherPath = `/manage/${activityName}/${payload.sessionId}${queryString}`
        if (!hasNavigatedRef.current) {
          hasNavigatedRef.current = true
          if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            wsRef.current.close()
          }
          void navigate(teacherPath)
        }
        return
      }
    } catch (authenticateError) {
      setError(authenticateError instanceof Error ? authenticateError.message : String(authenticateError))
      setIsSubmitting(false)
      teacherAuthRequestedRef.current = false
      return
    }

    if (!isWaitingForTeacher) {
      setError('Live session is unavailable right now. Please refresh and try again.')
      setIsSubmitting(false)
      teacherAuthRequestedRef.current = false
      return
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'verify-teacher-code',
          teacherCode: normalizedTeacherCode,
        }),
      )
    } else {
      setError('Not connected. Please refresh the page.')
      setIsSubmitting(false)
      teacherAuthRequestedRef.current = false
    }
  }

  const handleFieldChange = (fieldId: string, value: string) => {
    setWaitingRoomValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleFieldBlur = (fieldId: string) => {
    setTouchedFields((current) => ({
      ...current,
      [fieldId]: true,
    }))
  }

  const activityDisplayName = activity?.name || activityName
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const isSoloOnlyMode = entryPolicy === 'solo-only'

  const handleContinueSolo = () => {
    const nextTouchedFields = waitingRoomFields.reduce<Record<string, boolean>>((fields, field) => {
      fields[field.id] = true
      return fields
    }, {})
    setTouchedFields(nextTouchedFields)

    if (Object.keys(waitingRoomErrors).length > 0) {
      setError('Please complete the required details before continuing.')
      return
    }

    const queryString = typeof window !== 'undefined' ? window.location.search : ''
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      wsRef.current.close()
    }
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true
      void navigate(`/solo/${activityName}${queryString}`)
    }
  }

  const handleJoinLive = () => {
    const nextTouchedFields = waitingRoomFields.reduce<Record<string, boolean>>((fields, field) => {
      fields[field.id] = true
      return fields
    }, {})
    setTouchedFields(nextTouchedFields)

    if (Object.keys(waitingRoomErrors).length > 0) {
      setError('Please complete the required details before joining.')
      return
    }

    if (onJoinLive) {
      onJoinLive()
      return
    }

    if (!startedSessionId) {
      setError('Live session is unavailable right now. Please refresh and try again.')
      return
    }

    const queryString = typeof window !== 'undefined' ? window.location.search : ''
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true
      void navigate(`/${startedSessionId}${queryString}`)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full border-2 border-gray-200">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">{activityDisplayName}</h1>

        <div className="text-center mb-6">
          <p className="text-lg text-gray-600 mb-2">{viewModel.statusTitle}</p>
          {viewModel.showWaiterCount ? (
            <p className="text-2xl font-bold text-blue-600">{getWaiterMessage(waiterCount)}</p>
          ) : (
            <p className="text-sm text-gray-600">{viewModel.statusDetail}</p>
          )}
        </div>

        {waitingRoomFields.length > 0 && (
          <section aria-labelledby="waiting-room-fields-heading" className="border-t-2 border-gray-200 pt-6 mt-6">
            <h2 id="waiting-room-fields-heading" className="text-center text-gray-800 mb-2 font-semibold">{viewModel.fieldHeading}</h2>
            <p className="text-sm text-gray-600 text-center mb-4">{viewModel.fieldDescription}</p>
            <div className="space-y-4">
              {waitingRoomFields.map((field) => {
                const fieldId = `waiting-room-field-${field.id}`
                const helpId = field.helpText ? `${fieldId}-help` : undefined
                const errorId = waitingRoomErrors[field.id] ? `${fieldId}-error` : undefined
                const describedBy = [helpId, touchedFields[field.id] ? errorId : undefined].filter(Boolean).join(' ') || undefined
                const error = touchedFields[field.id] ? waitingRoomErrors[field.id] : undefined
                const CustomFieldComponent = field.type === 'custom' ? (customFieldComponents[field.component] ?? null) : null
                const customFieldStatus = getCustomFieldStatus(field, CustomFieldComponent, customFieldLoadError)
                const fieldLabel = (
                  <>
                    {getFieldLabel(field)}
                    {field.required ? ' *' : ''}
                  </>
                )

                return (
                  <div key={field.id} className="flex flex-col gap-2">
                    {field.type === 'custom' ? (
                      <div id={`${fieldId}-label`} className="text-sm font-semibold text-gray-700">
                        {fieldLabel}
                      </div>
                    ) : (
                      <label htmlFor={fieldId} className="text-sm font-semibold text-gray-700">
                        {fieldLabel}
                      </label>
                    )}

                    {field.type === 'text' && (
                      <input
                        id={fieldId}
                        type="text"
                        value={toFieldStringValue(waitingRoomValues[field.id])}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFieldChange(field.id, event.target.value)}
                        onBlur={() => handleFieldBlur(field.id)}
                        placeholder={field.placeholder}
                        className="border-2 border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
                        aria-invalid={error ? 'true' : undefined}
                        aria-describedby={describedBy}
                        aria-required={field.required || undefined}
                        required={field.required}
                      />
                    )}

                    {field.type === 'select' && (
                      <select
                        id={fieldId}
                        value={toFieldStringValue(waitingRoomValues[field.id])}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => handleFieldChange(field.id, event.target.value)}
                        onBlur={() => handleFieldBlur(field.id)}
                        className="border-2 border-gray-300 rounded px-4 py-2 bg-white focus:outline-none focus:border-blue-500"
                        aria-invalid={error ? 'true' : undefined}
                        aria-describedby={describedBy}
                        aria-required={field.required || undefined}
                        required={field.required}
                      >
                        <option value="">Select an option</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    )}

                    {field.type === 'custom' && (
                      <div
                        id={fieldId}
                        role="group"
                        aria-labelledby={`${fieldId}-label`}
                        aria-describedby={describedBy}
                        aria-invalid={error ? 'true' : undefined}
                        className="flex flex-col gap-2"
                      >
                        {CustomFieldComponent ? (
                          <CustomFieldComponent
                            field={field}
                            value={waitingRoomValues[field.id] ?? null}
                            onChange={(value) => {
                              setWaitingRoomValues((current) => ({
                                ...current,
                                [field.id]: value,
                              }))
                              handleFieldBlur(field.id)
                            }}
                            disabled={isSubmitting}
                            error={error}
                          />
                        ) : (
                          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            {customFieldStatus}
                          </div>
                        )}
                      </div>
                    )}

                    {field.helpText && (
                      <p id={helpId} className="text-xs text-gray-500">{field.helpText}</p>
                    )}
                    {error && (
                      <p id={errorId} className="text-sm text-red-600">{error}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {viewModel.primaryActionLabel && (
          <div className="border-t-2 border-gray-200 pt-6 mt-6 flex flex-col items-center gap-3">
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <Button type="button" onClick={entryOutcome === 'join-live' ? handleJoinLive : handleContinueSolo}>
              {viewModel.primaryActionLabel}
            </Button>
          </div>
        )}

        {viewModel.showTeacherSection && allowTeacherSection && (
          <div className="border-t-2 border-gray-200 pt-6 mt-6">
            <p className="text-center text-gray-700 mb-4 font-semibold">
              {entryOutcome === 'continue-solo' ? 'Want to start a live session instead?' : 'Are you the teacher?'}
            </p>

            <form onSubmit={handleTeacherCodeSubmit} className="flex flex-col items-center gap-4">
              <label htmlFor="waiting-room-teacher-code" className="sr-only">Teacher code</label>
              <input
                id="waiting-room-teacher-code"
                type="password"
                placeholder="Enter teacher code"
                value={teacherCode}
                onChange={(event) => setTeacherCode(event.target.value)}
                className="border-2 border-gray-300 rounded px-4 py-2 w-full max-w-xs text-center focus:outline-none focus:border-blue-500"
                disabled={isSubmitting}
                autoComplete="off"
              />

              {error && !viewModel.primaryActionLabel && <p className="text-red-600 text-sm">{error}</p>}

              <Button
                type="submit"
                disabled={isSubmitting || !teacherCode.trim() || isSoloOnlyMode}
              >
                {isSubmitting ? 'Verifying...' : entryOutcome === 'join-live' ? 'Open Manage Dashboard' : 'Start Activity'}
              </Button>
            </form>

            {isSoloOnlyMode && (
              <p className="text-xs text-gray-500 text-center mt-4">
                This link is configured for solo use only, so live teacher startup is unavailable here.
              </p>
            )}

            {hasTeacherCookie && (
              <p className="text-xs text-gray-500 text-center mt-4">
                Tip: Your browser remembers your teacher code for this link
              </p>
            )}
          </div>
        )}
      </div>

      {showShareUrl && (
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Share this URL with your students:</p>
          <code className="bg-gray-100 px-3 py-1 rounded mt-1 inline-block text-xs">{shareUrl}</code>
        </div>
      )}
    </div>
  )
}

interface HandleWaitingRoomMessageParams {
  message: WaitingRoomMessage
  setWaiterCount: (count: number) => void
  setError: (error: string | null) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  teacherAuthRequestedRef: { current: boolean }
  navigateOnce: (path: string) => void
  activityName: string
  queryString: string
}

function handleWaitingRoomMessage({
  message,
  setWaiterCount,
  setError,
  setIsSubmitting,
  teacherAuthRequestedRef,
  navigateOnce,
  activityName,
  queryString,
}: HandleWaitingRoomMessageParams): void {
  if (message.type === 'waiter-count') {
    setWaiterCount(message.count)
    return
  }

  if (message.type === 'session-started') {
    if (teacherAuthRequestedRef.current) {
      navigateOnce(`/manage/${activityName}/${message.sessionId}${queryString}`)
    } else {
      navigateOnce(`/${message.sessionId}${queryString}`)
    }
    return
  }

  if (message.type === 'session-ended') {
    navigateOnce('/session-ended')
    return
  }

  if (message.type === 'teacher-authenticated') {
    navigateOnce(`/manage/${activityName}/${message.sessionId}${queryString}`)
    return
  }

  if (message.type === 'teacher-code-error') {
    setError(message.error)
    setIsSubmitting(false)
    teacherAuthRequestedRef.current = false
  }
}
