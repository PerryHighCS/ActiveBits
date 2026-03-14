import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  WaitingRoomFieldConfig,
  WaitingRoomFieldComponentProps,
} from '../../../../types/waitingRoom.js'
import WaitingRoomContent from './WaitingRoomContent'
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
  buildPersistentEntryParticipantSubmitApiUrl,
  buildSessionEntryParticipantSubmitApiUrl,
  buildEntryParticipantStorageKey,
  persistEntryParticipantToken,
  persistEntryParticipantValues,
} from './entryParticipantStorage'
import {
  buildPersistentAuthenticateApiUrl,
  buildPersistentTeacherCodeApiUrl,
  buildPersistentSessionWsUrl,
  isWaitingRoomMessage,
  parseWaitingRoomMessage,
  type WaitingRoomMessage,
} from './waitingRoomUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'
import { resolvePersistentSessionAuthFailure, type PersistentSessionAuthErrorResponse } from './persistentSessionAuthUtils'
import { resolveWaitingRoomPrimaryAction } from './waitingRoomActionUtils'

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

  const handleFieldChange = (fieldId: string, value: WaitingRoomFieldValueMap[string]) => {
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

  const persistServerBackedSessionEntryParticipantHandoff = async (destinationId: string) => {
    if (typeof window === 'undefined' || window.sessionStorage == null) {
      return
    }

    const storageKey = buildEntryParticipantStorageKey(activityName, 'session', destinationId)

    try {
      const response = await fetch(buildSessionEntryParticipantSubmitApiUrl(destinationId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          values: waitingRoomValues,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to store waiting-room handoff (${response.status})`)
      }

      const payload = await response.json() as { entryParticipantToken?: unknown }
      const token = typeof payload.entryParticipantToken === 'string' ? payload.entryParticipantToken.trim() : ''
      if (!token) {
        throw new Error('Missing entry participant token')
      }

      persistEntryParticipantToken(window.sessionStorage, storageKey, token)
    } catch (error) {
      console.warn('[WaitingRoom] Failed to store session entry participant on server, falling back to client handoff:', error)
      persistEntryParticipantValues(window.sessionStorage, storageKey, waitingRoomValues)
    }
  }

  const persistServerBackedSoloEntryParticipantHandoff = async () => {
    if (typeof window === 'undefined' || window.sessionStorage == null) {
      return
    }

    const storageKey = buildEntryParticipantStorageKey(activityName, 'solo', activityName)

    try {
      const response = await fetch(buildPersistentEntryParticipantSubmitApiUrl(hash, activityName), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          values: waitingRoomValues,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to store solo waiting-room handoff (${response.status})`)
      }

      const payload = await response.json() as { entryParticipantToken?: unknown }
      const token = typeof payload.entryParticipantToken === 'string' ? payload.entryParticipantToken.trim() : ''
      if (!token) {
        throw new Error('Missing entry participant token')
      }

      persistEntryParticipantToken(window.sessionStorage, storageKey, token, { persistentHash: hash })
    } catch (error) {
      console.warn('[WaitingRoom] Failed to store solo entry participant on server, falling back to client handoff:', error)
      persistEntryParticipantValues(window.sessionStorage, storageKey, waitingRoomValues)
    }
  }

  const handleContinueSolo = async () => {
    const actionResolution = resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors,
      entryOutcome,
    })
    setTouchedFields(actionResolution.touchedFields)

    if (actionResolution.errorMessage) {
      setError(actionResolution.errorMessage)
      return
    }

    const queryString = typeof window !== 'undefined' ? window.location.search : ''
    await persistServerBackedSoloEntryParticipantHandoff()
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      wsRef.current.close()
    }
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true
      void navigate(`/solo/${activityName}${queryString}`)
    }
  }

  const handleJoinLive = async () => {
    const actionResolution = resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors,
      entryOutcome,
      startedSessionId,
    })
    setTouchedFields(actionResolution.touchedFields)

    if (actionResolution.errorMessage) {
      setError(actionResolution.errorMessage)
      return
    }

    const liveSessionId = startedSessionId
    if (!liveSessionId) {
      setError('Live session is unavailable right now. Please refresh and try again.')
      return
    }

    if (onJoinLive) {
      await persistServerBackedSessionEntryParticipantHandoff(liveSessionId)
      onJoinLive()
      return
    }

    const queryString = typeof window !== 'undefined' ? window.location.search : ''
    await persistServerBackedSessionEntryParticipantHandoff(liveSessionId)
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true
      void navigate(`/${liveSessionId}${queryString}`)
    }
  }

  return (
    <WaitingRoomContent
      activityDisplayName={activityDisplayName}
      waiterCount={waiterCount}
      error={error}
      isSubmitting={isSubmitting}
      waitingRoomFields={waitingRoomFields}
      waitingRoomValues={waitingRoomValues}
      touchedFields={touchedFields}
      waitingRoomErrors={waitingRoomErrors}
      customFieldComponents={customFieldComponents}
      customFieldLoadError={customFieldLoadError}
      entryOutcome={entryOutcome}
      entryPolicy={entryPolicy}
      allowTeacherSection={allowTeacherSection}
      showShareUrl={showShareUrl}
      hasTeacherCookie={hasTeacherCookie}
      teacherCode={teacherCode}
      shareUrl={shareUrl}
      onTeacherCodeChange={setTeacherCode}
      onTeacherCodeSubmit={handleTeacherCodeSubmit}
      onPrimaryAction={entryOutcome === 'join-live' ? handleJoinLive : handleContinueSolo}
      onFieldChange={handleFieldChange}
      onFieldBlur={handleFieldBlur}
    />
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
