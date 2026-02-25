import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import { getActivity } from '@src/activities'
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

/**
 * WaitingRoom component for persistent sessions
 * Shows waiting students count and allows teacher to enter code to start session
 */
export default function WaitingRoom({ activityName, hash, hasTeacherCookie }: WaitingRoomProps) {
  const [waiterCount, setWaiterCount] = useState(0)
  const [teacherCode, setTeacherCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const shouldAutoAuthRef = useRef(hasTeacherCookie)
  const hasNavigatedRef = useRef(false)
  const teacherAuthRequestedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    shouldAutoAuthRef.current = hasTeacherCookie
  }, [hasTeacherCookie])

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

  const handleTeacherCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    teacherAuthRequestedRef.current = true

    const normalizedTeacherCode = teacherCode.trim()

    try {
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

  const activityDisplayName = getActivity(activityName)?.name || activityName
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full border-2 border-gray-200">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">{activityDisplayName}</h1>

        <div className="text-center mb-6">
          <p className="text-lg text-gray-600 mb-2">Waiting for teacher to start the activity</p>
          <p className="text-2xl font-bold text-blue-600">{getWaiterMessage(waiterCount)}</p>
        </div>

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
