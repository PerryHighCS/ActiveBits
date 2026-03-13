import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  WaitingRoomFieldConfig,
  WaitingRoomSerializableValue,
} from '../../../../types/waitingRoom.js'
import Button from '../ui/Button'
import { getActivity } from '@src/activities'
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

interface WaitingRoomProps {
  activityName: string
  hash: string
  hasTeacherCookie: boolean
}

interface TeacherAuthenticateResponse {
  error?: string
  isStarted?: boolean
  sessionId?: string | null
}

const EMPTY_WAITING_ROOM_FIELDS: readonly WaitingRoomFieldConfig[] = []

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
export default function WaitingRoom({ activityName, hash, hasTeacherCookie }: WaitingRoomProps) {
  const activity = getActivity(activityName)
  const waitingRoomFields = activity?.waitingRoom?.fields ?? EMPTY_WAITING_ROOM_FIELDS
  const [waiterCount, setWaiterCount] = useState(0)
  const [teacherCode, setTeacherCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [waitingRoomValues, setWaitingRoomValues] = useState<WaitingRoomFieldValueMap>({})
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({})
  const shouldAutoAuthRef = useRef(hasTeacherCookie)
  const hasNavigatedRef = useRef(false)
  const teacherAuthRequestedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    shouldAutoAuthRef.current = hasTeacherCookie
  }, [hasTeacherCookie])

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
    setError(null)
    teacherAuthRequestedRef.current = false

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
  }, [activityName, hash, navigate])

  const waitingRoomErrors = validateWaitingRoomValues(waitingRoomFields, waitingRoomValues)

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
        throw new Error(payload.error || 'Invalid teacher code')
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

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full border-2 border-gray-200">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">{activityDisplayName}</h1>

        <div className="text-center mb-6">
          <p className="text-lg text-gray-600 mb-2">Waiting for teacher to start the activity</p>
          <p className="text-2xl font-bold text-blue-600">{getWaiterMessage(waiterCount)}</p>
        </div>

        {waitingRoomFields.length > 0 && (
          <section aria-labelledby="waiting-room-fields-heading" className="border-t-2 border-gray-200 pt-6 mt-6">
            <h2 id="waiting-room-fields-heading" className="text-center text-gray-800 mb-2 font-semibold">Before you join</h2>
            <p className="text-sm text-gray-600 text-center mb-4">Complete these details while you wait for the activity to begin.</p>
            <div className="space-y-4">
              {waitingRoomFields.map((field) => {
                const fieldId = `waiting-room-field-${field.id}`
                const helpId = field.helpText ? `${fieldId}-help` : undefined
                const errorId = waitingRoomErrors[field.id] ? `${fieldId}-error` : undefined
                const describedBy = [helpId, touchedFields[field.id] ? errorId : undefined].filter(Boolean).join(' ') || undefined
                const error = touchedFields[field.id] ? waitingRoomErrors[field.id] : undefined

                return (
                  <div key={field.id} className="flex flex-col gap-2">
                    <label htmlFor={fieldId} className="text-sm font-semibold text-gray-700">
                      {getFieldLabel(field)}
                      {field.required ? ' *' : ''}
                    </label>

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
                        className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                        aria-describedby={describedBy}
                      >
                        Custom waiting-room fields are not available yet for {getFieldLabel(field)}.
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

        <div className="border-t-2 border-gray-200 pt-6 mt-6">
          <p className="text-center text-gray-700 mb-4 font-semibold">Are you the teacher?</p>

          <form onSubmit={handleTeacherCodeSubmit} className="flex flex-col items-center gap-4">
            <input
              type="password"
              placeholder="Enter teacher code"
              value={teacherCode}
              onChange={(event) => setTeacherCode(event.target.value)}
              className="border-2 border-gray-300 rounded px-4 py-2 w-full max-w-xs text-center focus:outline-none focus:border-blue-500"
              disabled={isSubmitting}
              autoComplete="off"
            />

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <Button
              type="submit"
              disabled={isSubmitting || !teacherCode.trim()}
            >
              {isSubmitting ? 'Verifying...' : 'Start Activity'}
            </Button>
          </form>

          {hasTeacherCookie && (
            <p className="text-xs text-gray-500 text-center mt-4">
              Tip: Your browser remembers your teacher code for this link
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 text-center text-sm text-gray-500">
        <p>Share this URL with your students:</p>
        <code className="bg-gray-100 px-3 py-1 rounded mt-1 inline-block text-xs">{shareUrl}</code>
      </div>
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
