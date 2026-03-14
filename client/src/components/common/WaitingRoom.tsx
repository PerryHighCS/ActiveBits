import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  WaitingRoomFieldConfig,
  WaitingRoomFieldComponentProps,
} from '../../../../types/waitingRoom.js'
import WaitingRoomContent from './WaitingRoomContent'
import { getActivity, loadActivityWaitingRoomFields } from '@src/activities'
import {
  getPersistentLinkControlStateFromSearch,
  getPersistentSelectedOptionsFromSearchForActivity,
} from './sessionRouterUtils'
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
} from './entryParticipantStorage'
import {
  buildPersistentAuthenticateApiUrl,
  buildPersistentSessionWsUrl,
} from './waitingRoomUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'
import { resolvePersistentSessionAuthFailure, type PersistentSessionAuthErrorResponse } from './persistentSessionAuthUtils'
import { resolveWaitingRoomPrimaryAction } from './waitingRoomActionUtils'
import { persistWaitingRoomServerBackedHandoff } from './waitingRoomHandoffUtils'
import { resolveWaitingRoomTeacherSubmitResult } from './waitingRoomTeacherSubmitUtils'
import { attachWaitingRoomSocketHandlers } from './waitingRoomSocketUtils'

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
    attachWaitingRoomSocketHandlers({
      ws,
      shouldAutoAuth: shouldAutoAuthRef.current,
      hash,
      activityName,
      queryString: typeof window !== 'undefined' ? window.location.search : '',
      hasNavigatedRef,
      teacherAuthRequestedRef,
      setWaiterCount,
      setError,
      setIsSubmitting,
      navigate,
    })

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
    const queryString = typeof window !== 'undefined' ? window.location.search : ''

    try {
      const selectedOptions = getPersistentSelectedOptionsFromSearchForActivity(
        queryString,
        activity?.deepLinkOptions,
        activityName,
      )
      const persistentLinkControlState = getPersistentLinkControlStateFromSearch(queryString)

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
          entryPolicy: persistentLinkControlState.entryPolicy,
          urlHash: persistentLinkControlState.urlHash,
        }),
      })

      if (!authenticateResponse.ok) {
        const payload = (await authenticateResponse.json().catch(() => ({}))) as TeacherAuthenticateResponse
        throw new Error(resolvePersistentSessionAuthFailure(payload).message)
      }

      const payload = (await authenticateResponse.json()) as TeacherAuthenticateResponse
      const submissionResolution = resolveWaitingRoomTeacherSubmitResult({
        payload,
        activityName,
        queryString,
        normalizedTeacherCode,
        isWaitingForTeacher,
        hasOpenSocket: wsRef.current?.readyState === WebSocket.OPEN,
      })

      if (typeof submissionResolution.navigateTo === 'string') {
        if (!hasNavigatedRef.current) {
          hasNavigatedRef.current = true
          if (submissionResolution.closeSocket && wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            wsRef.current.close()
          }
          void navigate(submissionResolution.navigateTo)
        }
        return
      }

      if (typeof submissionResolution.sendVerifyTeacherCode === 'string' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'verify-teacher-code',
            teacherCode: submissionResolution.sendVerifyTeacherCode,
          }),
        )
        return
      }

      if (submissionResolution.clearTeacherAuthRequested) {
        teacherAuthRequestedRef.current = false
      }
      if (typeof submissionResolution.isSubmitting === 'boolean') {
        setIsSubmitting(submissionResolution.isSubmitting)
      }
      if (typeof submissionResolution.errorMessage === 'string') {
        setError(submissionResolution.errorMessage)
        return
      }
    } catch (authenticateError) {
      setError(authenticateError instanceof Error ? authenticateError.message : String(authenticateError))
      setIsSubmitting(false)
      teacherAuthRequestedRef.current = false
      return
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
    await persistWaitingRoomServerBackedHandoff({
      storage: typeof window !== 'undefined' ? window.sessionStorage : null,
      participantContextStorage: typeof window !== 'undefined' ? window.localStorage : null,
      storageKey: buildEntryParticipantStorageKey(activityName, 'session', destinationId),
      values: waitingRoomValues,
      submitApiUrl: buildSessionEntryParticipantSubmitApiUrl(destinationId),
      sessionParticipantContextSessionId: destinationId,
    })
  }

  const persistServerBackedSoloEntryParticipantHandoff = async () => {
    await persistWaitingRoomServerBackedHandoff({
      storage: typeof window !== 'undefined' ? window.sessionStorage : null,
      storageKey: buildEntryParticipantStorageKey(activityName, 'solo', activityName),
      values: waitingRoomValues,
      submitApiUrl: buildPersistentEntryParticipantSubmitApiUrl(hash, activityName),
      persistentHash: hash,
    })
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
