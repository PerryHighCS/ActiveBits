import { Suspense, useCallback, useEffect, useState, type ChangeEvent, type ComponentType, type FormEvent } from 'react'
import type { PersistentSessionEntryStatus, SessionEntryStatus } from '../../../../types/waitingRoom.js'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import Button from '@src/components/ui/Button'
import WaitingRoom from './WaitingRoom'
import LoadingFallback from './LoadingFallback'
import { getActivity, activities } from '@src/activities'
import {
  activitySupportsDirectStandalonePath,
  buildTeacherManagePathFromSession,
  buildPersistentSessionEntryApiUrl,
  buildSessionEntryApiUrl,
  buildPersistentTeacherManagePath,
  CACHE_TTL,
  cleanExpiredSessions,
  findUtilityRouteMatch,
  getHomeUtilityActivities,
  getSessionPresentationUrlForTeacherRedirect,
  getStandaloneHomeActivities,
  isJoinSessionId,
  readCachedSession,
  type SessionCacheRecord,
} from './sessionRouterUtils'
import {
  buildSessionEntryParticipantStorageKey,
  hasValidEntryParticipantHandoffStorageValue,
} from './entryParticipantStorage'
import { shouldAutoRedirectPersistentTeacherToManage, shouldRenderSessionJoinPreflight } from './sessionEntryRenderUtils'
import { readSessionParticipantContext } from './sessionParticipantContext'

interface RouteParams {
  [key: string]: string | undefined
  sessionId?: string
  activityName?: string
  hash?: string
  soloActivityId?: string
  utilityActivityId?: string
  utilityId?: string
}

interface SessionPayload {
  session?: Record<string, unknown>
}

interface SessionData extends SessionCacheRecord {
  sessionId: string
  type?: string
}

type ActivityStudentComponent = ComponentType<Record<string, unknown>>
type UtilityComponent = ComponentType<Record<string, unknown>>

const colorClasses: Record<string, string> = {
  blue: 'bg-blue-600',
  green: 'bg-green-600',
  purple: 'bg-purple-600',
  red: 'bg-red-600',
  yellow: 'bg-yellow-600',
  indigo: 'bg-indigo-600',
  orange: 'bg-orange-600',
  emerald: 'bg-emerald-600',
  sky: 'bg-sky-600',
  fuchsia: 'bg-fuchsia-600',
  pink: 'bg-pink-600',
  rose: 'bg-rose-600',
  lime: 'bg-lime-600',
  teal: 'bg-teal-600',
}

const bgColorClasses: Record<string, string> = {
  blue: 'bg-blue-50',
  green: 'bg-green-50',
  purple: 'bg-purple-50',
  red: 'bg-red-50',
  yellow: 'bg-yellow-50',
  indigo: 'bg-indigo-50',
  orange: 'bg-orange-50',
  emerald: 'bg-emerald-50',
  sky: 'bg-sky-50',
  fuchsia: 'bg-fuchsia-50',
  pink: 'bg-pink-50',
  rose: 'bg-rose-50',
  lime: 'bg-lime-50',
  teal: 'bg-teal-50',
}

function getWindowSearch(): string {
  return typeof window !== 'undefined' ? window.location.search : ''
}

const SessionRouter = () => {
  const [sessionIdInput, setSessionIdInput] = useState('')
  const { sessionId, activityName, hash, soloActivityId, utilityActivityId, utilityId } = useParams<RouteParams>()
  const location = useLocation()

  const [sessionData, setSessionData] = useState<SessionData | null>(null)
  const [sessionEntryStatus, setSessionEntryStatus] = useState<SessionEntryStatus | null>(null)
  const [completedJoinPreflightSessionId, setCompletedJoinPreflightSessionId] = useState<string | null>(null)
  const [persistentSessionEntryStatus, setPersistentSessionEntryStatus] = useState<PersistentSessionEntryStatus | null>(null)
  const [isLoadingPersistent, setIsLoadingPersistent] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const hasStoredSessionParticipantContext = (
    typeof window !== 'undefined'
    && sessionId != null
  ) ? Boolean(readSessionParticipantContext(window.localStorage, sessionId)) : false
  const hasStoredPersistentSessionParticipantContext = (
    typeof window !== 'undefined'
    && persistentSessionEntryStatus?.sessionId != null
  ) ? Boolean(readSessionParticipantContext(window.localStorage, persistentSessionEntryStatus.sessionId)) : false
  const hasStoredSessionEntryParticipantHandoff = (
    typeof window !== 'undefined'
    && sessionEntryStatus?.sessionId != null
    && sessionEntryStatus?.activityName != null
    && window.sessionStorage != null
  ) ? hasValidEntryParticipantHandoffStorageValue(
    window.sessionStorage,
    buildSessionEntryParticipantStorageKey(sessionEntryStatus.activityName, sessionEntryStatus.sessionId),
  ) : false
  const hasStoredPersistentEntryParticipantHandoff = (
    typeof window !== 'undefined'
    && persistentSessionEntryStatus?.sessionId != null
    && activityName != null
    && window.sessionStorage != null
  ) ? hasValidEntryParticipantHandoffStorageValue(
    window.sessionStorage,
    buildSessionEntryParticipantStorageKey(activityName, persistentSessionEntryStatus.sessionId),
  ) : false
  const soloActivity = soloActivityId
    ? activities.find((entry) => entry.id === soloActivityId && activitySupportsDirectStandalonePath(entry)) ?? null
    : null
  const soloRouteError = soloActivityId == null
    ? null
    : soloActivity != null
      ? null
      : activities.some((entry) => entry.id === soloActivityId)
        ? 'This activity does not support solo mode'
        : 'Unknown solo activity'
  const utilityRouteMatch = (utilityActivityId != null && utilityId != null)
    ? findUtilityRouteMatch(activities, location.pathname)
    : null
  const utilityRouteError = utilityActivityId == null
    ? null
    : utilityRouteMatch != null
      ? null
      : 'Unknown utility route'

  const resolveTeacherManagePath = useCallback(
    async (
      nextActivityName: string,
      nextSessionId: string,
      queryString: string,
    ): Promise<string> => {
      if (nextActivityName !== 'syncdeck') {
        return buildPersistentTeacherManagePath(nextActivityName, nextSessionId, queryString)
      }

      try {
        const response = await fetch(`/api/session/${nextSessionId}`)
        if (!response.ok) {
          return buildPersistentTeacherManagePath(nextActivityName, nextSessionId, queryString)
        }

        const payload = (await response.json()) as SessionPayload
        const sessionPresentationUrl = getSessionPresentationUrlForTeacherRedirect(payload.session)
        return buildTeacherManagePathFromSession(nextActivityName, nextSessionId, queryString, sessionPresentationUrl)
      } catch {
        return buildPersistentTeacherManagePath(nextActivityName, nextSessionId, queryString)
      }
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    cleanExpiredSessions(localStorage, Date.now(), CACHE_TTL)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      setCompletedJoinPreflightSessionId(null)
      setSessionData(null)
      setSessionEntryStatus(null)
      setError(null)
    })
  }, [sessionId])

  useEffect(() => {
    if (!hash || !activityName) return

    queueMicrotask(() => {
      setIsLoadingPersistent(true)
      setPersistentSessionEntryStatus(null)
      setError(null)
    })
    const url = buildPersistentSessionEntryApiUrl(hash, activityName, getWindowSearch())
    fetch(url, { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Persistent session not found')
        return response.json() as Promise<PersistentSessionEntryStatus>
      })
      .then((data) => {
        setPersistentSessionEntryStatus(data)
        setIsLoadingPersistent(false)
      })
      .catch(() => {
        setError('Invalid persistent session link')
        setIsLoadingPersistent(false)
      })
  }, [hash, activityName])

  useEffect(() => {
    if (!activityName) return
    if (!shouldAutoRedirectPersistentTeacherToManage({
      isStarted: persistentSessionEntryStatus?.isStarted,
      sessionId: persistentSessionEntryStatus?.sessionId,
      resolvedRole: persistentSessionEntryStatus?.resolvedRole,
      entryOutcome: persistentSessionEntryStatus?.entryOutcome,
      presentationMode: persistentSessionEntryStatus?.presentationMode,
    })) {
      return
    }

    let isCancelled = false
    const startedSessionId = persistentSessionEntryStatus?.sessionId
    if (!startedSessionId) {
      return
    }
    const queryString = getWindowSearch()

    void (async () => {
      const path = await resolveTeacherManagePath(activityName, startedSessionId, queryString)
      if (!isCancelled) {
        void navigate(path, { replace: true })
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [
    activityName,
    persistentSessionEntryStatus?.entryOutcome,
    persistentSessionEntryStatus?.isStarted,
    persistentSessionEntryStatus?.presentationMode,
    persistentSessionEntryStatus?.resolvedRole,
    persistentSessionEntryStatus?.sessionId,
    navigate,
    resolveTeacherManagePath,
  ])

  useEffect(() => {
    if (!hash || !activityName) return undefined
    if (!persistentSessionEntryStatus?.isStarted) return undefined

    let isCancelled = false

    const pollStatus = async () => {
      try {
        const url = buildPersistentSessionEntryApiUrl(hash, activityName, getWindowSearch())
        const response = await fetch(url, {
          credentials: 'include',
        })

        if (!response.ok) return

        const data = (await response.json()) as PersistentSessionEntryStatus
        if (isCancelled) return

        setPersistentSessionEntryStatus(data)
        if (!data.isStarted) {
          void navigate('/session-ended')
        }
      } catch (pollError) {
        if (!isCancelled) {
          console.error('Failed to poll persistent session status:', pollError)
        }
      }
    }

    const intervalId = setInterval(() => void pollStatus(), 5000)
    void pollStatus()

    return () => {
      isCancelled = true
      clearInterval(intervalId)
    }
  }, [activityName, hash, navigate, persistentSessionEntryStatus?.isStarted])

  useEffect(() => {
    if (!hash || !activityName || !persistentSessionEntryStatus?.isStarted || !persistentSessionEntryStatus.sessionId) {
      return
    }

    if (
      persistentSessionEntryStatus.resolvedRole !== 'student'
      || persistentSessionEntryStatus.entryOutcome !== 'join-live'
      || persistentSessionEntryStatus.presentationMode !== 'pass-through'
    ) {
      return
    }

    void navigate(`/${persistentSessionEntryStatus.sessionId}`, { replace: true })
  }, [activityName, hash, navigate, persistentSessionEntryStatus])

  useEffect(() => {
    if (!hash || !activityName || !persistentSessionEntryStatus?.isStarted || !persistentSessionEntryStatus.sessionId) {
      return
    }

    if (
      persistentSessionEntryStatus.resolvedRole !== 'student'
      || persistentSessionEntryStatus.entryOutcome !== 'join-live'
      || persistentSessionEntryStatus.presentationMode !== 'render-ui'
      || persistentSessionEntryStatus.entryPolicy === 'solo-allowed'
      || !hasStoredPersistentSessionParticipantContext
    ) {
      return
    }

    void navigate(`/${persistentSessionEntryStatus.sessionId}`, { replace: true })
  }, [activityName, hash, hasStoredPersistentSessionParticipantContext, navigate, persistentSessionEntryStatus])

  useEffect(() => {
    if (!sessionId || sessionEntryStatus) return

    fetch(buildSessionEntryApiUrl(sessionId))
      .then((response) => {
        if (!response.ok) throw new Error('Session not found')
        return response.json() as Promise<SessionEntryStatus>
      })
      .then((payload) => {
        setSessionEntryStatus(payload)
      })
      .catch(() => setError('Invalid or missing session'))
  }, [sessionEntryStatus, sessionId])

  useEffect(() => {
    if (!sessionId || sessionData || typeof window === 'undefined') return
    if (!sessionEntryStatus) return
    if (shouldRenderSessionJoinPreflight({
      sessionId: sessionEntryStatus.sessionId,
      presentationMode: sessionEntryStatus.presentationMode,
      completedJoinPreflightSessionId,
      hasStoredParticipantContext: hasStoredSessionParticipantContext,
      hasStoredEntryParticipantHandoff: hasStoredSessionEntryParticipantHandoff,
    })) {
      return
    }

    const storageKey = `session-${sessionId}`
    const cached = readCachedSession(localStorage, storageKey, Date.now(), CACHE_TTL)
    if (cached) {
      queueMicrotask(() => {
        setSessionData(cached as SessionData)
      })
      return
    }

    fetch(`/api/session/${sessionId}`)
      .then((response) => {
        if (!response.ok) throw new Error('Session not found')
        return response.json() as Promise<SessionPayload>
      })
      .then((payload) => {
        const fullData: SessionData = {
          ...(payload.session || {}),
          sessionId,
          timestamp: Date.now(),
        }

        localStorage.setItem(storageKey, JSON.stringify(fullData))
        setSessionData(fullData)
      })
      .catch(() => setError('Invalid or missing session'))
  }, [
    completedJoinPreflightSessionId,
    hasStoredSessionEntryParticipantHandoff,
    hasStoredSessionParticipantContext,
    sessionData,
    sessionEntryStatus,
    sessionId,
  ])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSessionIdInput(event.target.value.toLowerCase())
    setError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isJoinSessionId(sessionIdInput)) {
      void navigate(`/${sessionIdInput.trim()}`)
    }
  }

  if (error || soloRouteError || utilityRouteError) {
    return <div className="text-red-500 text-center">{error || soloRouteError || utilityRouteError}</div>
  }

  if (hash && activityName) {
    if (isLoadingPersistent || persistentSessionEntryStatus === null) {
      return <div className="text-center">Loading...</div>
    }

    const persistentActivity = getActivity(activityName)
    const persistentEntryOutcome = persistentSessionEntryStatus.entryOutcome

    if (persistentEntryOutcome === 'solo-unavailable') {
      return (
        <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg lg:p-6 border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-800 mb-3 text-center">Live session required</h1>
          <p className="text-gray-700 text-center mb-4">
            This permanent link is configured for solo entry, but {persistentActivity?.name || activityName} does not support solo mode.
          </p>
          <p className="text-sm text-gray-600 text-center">
            Ask your teacher for a live session link or return when they have started a classroom session for this activity.
          </p>
        </div>
      )
    }

    if (persistentSessionEntryStatus.isStarted && persistentSessionEntryStatus.sessionId) {
      const startedSessionId = persistentSessionEntryStatus.sessionId
      if (shouldRenderSessionJoinPreflight({
        sessionId: startedSessionId,
        presentationMode: persistentSessionEntryStatus.presentationMode,
        hasStoredParticipantContext: hasStoredPersistentSessionParticipantContext,
        hasStoredEntryParticipantHandoff: hasStoredPersistentEntryParticipantHandoff,
        allowStoredParticipantContext: persistentSessionEntryStatus.entryPolicy === 'solo-allowed',
      })) {
        return (
          <WaitingRoom
            activityName={activityName}
            hash={hash}
            hasTeacherCookie={persistentSessionEntryStatus.hasTeacherCookie}
            entryOutcome={persistentEntryOutcome}
            entryPolicy={persistentSessionEntryStatus.entryPolicy}
            startedSessionId={startedSessionId}
          />
        )
      }
      return <div className="text-center">Redirecting to session...</div>
    }

    return (
      <WaitingRoom
        activityName={activityName}
        hash={hash}
        hasTeacherCookie={persistentSessionEntryStatus.hasTeacherCookie}
        entryOutcome={persistentEntryOutcome}
        entryPolicy={persistentSessionEntryStatus.entryPolicy}
      />
    )
  }

  if (soloActivity) {
    const StudentComponent = soloActivity.StudentComponent

    if (!StudentComponent) {
      return <div className="text-center">Solo mode is unavailable for this activity.</div>
    }

    const SoloStudentComponent = StudentComponent as ActivityStudentComponent

    return (
      <Suspense fallback={<LoadingFallback />}>
        <SoloStudentComponent sessionData={{ sessionId: `solo-${soloActivity.id}`, studentName: 'Solo Student' }} />
      </Suspense>
    )
  }

  if (utilityRouteMatch) {
    if (utilityRouteMatch.utility.renderTarget === 'util') {
      const UtilComponent = utilityRouteMatch.activity.UtilComponent
      if (!UtilComponent) {
        return <div className="text-center">Utility view is unavailable for this activity.</div>
      }

      const TypedUtilComponent = UtilComponent as UtilityComponent

      return (
        <Suspense fallback={<LoadingFallback />}>
          <TypedUtilComponent />
        </Suspense>
      )
    }

    const StudentComponent = utilityRouteMatch.activity.StudentComponent

    if (!StudentComponent) {
      return <div className="text-center">Utility view is unavailable for this activity.</div>
    }

    const UtilityStudentComponent = StudentComponent as ActivityStudentComponent
    const utilitySessionId = utilityRouteMatch.utility.standaloneSessionId || `solo-${utilityRouteMatch.activity.id}`

    return (
      <Suspense fallback={<LoadingFallback />}>
        <UtilityStudentComponent sessionData={{ sessionId: utilitySessionId, studentName: 'Utility User' }} />
      </Suspense>
    )
  }

  if (!sessionId) {
    const standaloneActivities = getStandaloneHomeActivities(activities)
    const utilityActivities = getHomeUtilityActivities(activities)

    return (
      <div className="flex flex-col items-center gap-8 max-w-6xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="flex flex-col items-center w-max mx-auto">
          <label className="block mb-4">
            Join Session ID:
            <input
              className="border border-grey-700 rounded mx-2 p-2"
              size={5}
              type="text"
              id="sessionId"
              value={sessionIdInput}
              onChange={handleInputChange}
            />
          </label>
          <Button type="submit">Join Session</Button>
        </form>

        {standaloneActivities.length > 0 && (
          <div className="w-full border-t-2 border-gray-300 pt-8">
            <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">Standalone Activities</h2>
            <p className="text-center text-gray-600 mb-6">Practice on your own</p>
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {standaloneActivities.map((activity) => {
                const standaloneTitle = activity.standaloneEntry.title || activity.name
                const standaloneDescription = activity.standaloneEntry.description || activity.description

                return (
                  <div
                    key={activity.id}
                    onClick={() => navigate(`/solo/${activity.id}`)}
                    className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer h-full flex flex-col"
                  >
                    <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-3`}>
                      <h3 className="text-xl font-semibold">{standaloneTitle}</h3>
                    </div>
                    <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4 flex-1`}>
                      <p className="text-gray-600">{standaloneDescription}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {utilityActivities.length > 0 && (
          <div className="w-full border-t-2 border-gray-300 pt-8">
            <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">Utility Tools</h2>
            <p className="text-center text-gray-600 mb-6">Activity-specific tools and viewers</p>
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {utilityActivities.flatMap((activity) =>
                (activity.utilities ?? [])
                  .filter((utility) => utility.surfaces?.includes('home'))
                  .map((utility) => (
                    <div
                      key={`${activity.id}:${utility.id}`}
                      onClick={() => navigate(utility.path)}
                      className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer h-full flex flex-col"
                    >
                      <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-3`}>
                        <h3 className="text-xl font-semibold">{utility.label}</h3>
                      </div>
                      <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4 flex-1`}>
                        <p className="text-gray-600">{utility.description || activity.description}</p>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (sessionEntryStatus && shouldRenderSessionJoinPreflight({
    sessionId: sessionEntryStatus.sessionId,
    presentationMode: sessionEntryStatus.presentationMode,
    completedJoinPreflightSessionId,
    hasStoredParticipantContext: hasStoredSessionParticipantContext,
    hasStoredEntryParticipantHandoff: hasStoredSessionEntryParticipantHandoff,
  })) {
    return (
      <WaitingRoom
        activityName={sessionEntryStatus.activityName}
        hash={sessionEntryStatus.sessionId}
        hasTeacherCookie={false}
        entryOutcome={sessionEntryStatus.entryOutcome}
        startedSessionId={sessionEntryStatus.sessionId}
        allowTeacherSection={false}
        showShareUrl={false}
        onJoinLive={() => setCompletedJoinPreflightSessionId(sessionEntryStatus.sessionId)}
      />
    )
  }

  if (sessionId && !sessionEntryStatus) return <div className="text-center">Loading session...</div>

  if (!sessionData) return <div className="text-center">Loading session...</div>

  const activity = getActivity(sessionData.type || '')

  if (!activity) {
    return <div className="text-center">Unknown session type: {sessionData.type}</div>
  }

  const StudentComponent = activity.StudentComponent
  if (!StudentComponent) {
    return <div className="text-center">Activity student view is unavailable.</div>
  }

  const SessionStudentComponent = StudentComponent as ActivityStudentComponent

  return (
    <Suspense fallback={<LoadingFallback />}>
      <SessionStudentComponent sessionData={sessionData} persistentSessionInfo={persistentSessionEntryStatus} />
    </Suspense>
  )
}

export default SessionRouter
