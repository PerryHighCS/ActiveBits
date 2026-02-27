import { Suspense, useCallback, useEffect, useState, type ChangeEvent, type ComponentType, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '@src/components/ui/Button'
import WaitingRoom from './WaitingRoom'
import LoadingFallback from './LoadingFallback'
import { getActivity, activities } from '@src/activities'
import {
  buildTeacherManagePathFromSession,
  buildPersistentSessionApiUrl,
  buildPersistentTeacherManagePath,
  CACHE_TTL,
  cleanExpiredSessions,
  getSessionPresentationUrlForTeacherRedirect,
  getPersistentSelectedOptionsFromSearchForActivity,
  getSoloActivities,
  isJoinSessionId,
  readCachedSession,
  type SessionCacheRecord,
} from './sessionRouterUtils'

interface RouteParams {
  [key: string]: string | undefined
  sessionId?: string
  activityName?: string
  hash?: string
  soloActivityId?: string
}

interface SessionPayload {
  session?: Record<string, unknown>
}

interface PersistentSessionInfo {
  isStarted?: boolean
  sessionId?: string
  hasTeacherCookie?: boolean
}

interface TeacherAuthResponse {
  sessionId?: string
  error?: string
}

interface SessionData extends SessionCacheRecord {
  sessionId: string
  type?: string
}

type ActivityStudentComponent = ComponentType<Record<string, unknown>>

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
  const [soloActivity, setSoloActivity] = useState<(typeof activities)[number] | null>(null)

  const { sessionId, activityName, hash, soloActivityId } = useParams<RouteParams>()

  const [sessionData, setSessionData] = useState<SessionData | null>(null)
  const [persistentSessionInfo, setPersistentSessionInfo] = useState<PersistentSessionInfo | null>(null)
  const [isLoadingPersistent, setIsLoadingPersistent] = useState(false)
  const [teacherCode, setTeacherCode] = useState('')
  const [teacherAuthError, setTeacherAuthError] = useState('')
  const [isAuthenticatingTeacher, setIsAuthenticatingTeacher] = useState(false)
  const [showTeacherAuth, setShowTeacherAuth] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

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
    if (hash && activityName) {
      setTeacherCode('')
      setTeacherAuthError('')
      setIsAuthenticatingTeacher(false)
      setShowTeacherAuth(false)
    }
  }, [hash, activityName])

  useEffect(() => {
    if (!soloActivityId) {
      setSoloActivity(null)
      setError(null)
      return
    }

    const activity = activities.find((entry) => entry.id === soloActivityId)
    if (!activity) {
      setSoloActivity(null)
      setError('Unknown solo activity')
      return
    }

    if (!activity.soloMode) {
      setSoloActivity(null)
      setError('This activity does not support solo mode')
      return
    }

    setError(null)
    setSoloActivity(activity)
  }, [soloActivityId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    cleanExpiredSessions(localStorage, Date.now(), CACHE_TTL)
  }, [])

  useEffect(() => setError(null), [sessionIdInput])

  useEffect(() => {
    if (!hash || !activityName) return

    setIsLoadingPersistent(true)
    setPersistentSessionInfo(null)

    const url = buildPersistentSessionApiUrl(hash, activityName, getWindowSearch())
    fetch(url, { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Persistent session not found')
        return response.json() as Promise<PersistentSessionInfo>
      })
      .then((data) => {
        setPersistentSessionInfo(data)
        setIsLoadingPersistent(false)
      })
      .catch(() => {
        setError('Invalid persistent session link')
        setIsLoadingPersistent(false)
      })
  }, [hash, activityName])

  useEffect(() => {
    if (!activityName) return
    if (!persistentSessionInfo?.isStarted || !persistentSessionInfo.sessionId) return
    if (!persistentSessionInfo.hasTeacherCookie) return

    let isCancelled = false
    const startedSessionId = persistentSessionInfo.sessionId
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
    persistentSessionInfo?.hasTeacherCookie,
    persistentSessionInfo?.isStarted,
    persistentSessionInfo?.sessionId,
    navigate,
    resolveTeacherManagePath,
  ])

  useEffect(() => {
    if (!hash || !activityName) return undefined
    if (!persistentSessionInfo?.isStarted) return undefined

    let isCancelled = false

    const pollStatus = async () => {
      try {
        const url = buildPersistentSessionApiUrl(hash, activityName, getWindowSearch())
        const response = await fetch(url, {
          credentials: 'include',
        })

        if (!response.ok) return

        const data = (await response.json()) as PersistentSessionInfo
        if (isCancelled) return

        setPersistentSessionInfo(data)
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
  }, [hash, activityName, persistentSessionInfo?.isStarted, navigate])

  useEffect(() => {
    if (!sessionId || sessionData || typeof window === 'undefined') return

    const storageKey = `session-${sessionId}`
    const cached = readCachedSession(localStorage, storageKey, Date.now(), CACHE_TTL)
    if (cached) {
      setSessionData(cached as SessionData)
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
  }, [sessionId, sessionData])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSessionIdInput(event.target.value.toLowerCase())
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isJoinSessionId(sessionIdInput)) {
      void navigate(`/${sessionIdInput.trim()}`)
    }
  }

  if (error) return <div className="text-red-500 text-center">{error}</div>

  if (hash && activityName) {
    if (isLoadingPersistent || persistentSessionInfo === null) {
      return <div className="text-center">Loading...</div>
    }

    if (persistentSessionInfo?.isStarted && persistentSessionInfo.sessionId) {
      const startedSessionId = persistentSessionInfo.sessionId

      if (persistentSessionInfo.hasTeacherCookie) {
        return <div className="text-center">Redirecting to session...</div>
      }

      const handleTeacherLogin = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setTeacherAuthError('')
        setIsAuthenticatingTeacher(true)

        try {
          const response = await fetch('/api/persistent-session/authenticate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              activityName,
              hash,
              teacherCode: teacherCode.trim(),
              selectedOptions: getPersistentSelectedOptionsFromSearchForActivity(
                getWindowSearch(),
                getActivity(activityName)?.deepLinkOptions,
                activityName,
              ),
            }),
          })

          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as TeacherAuthResponse
            throw new Error(payload.error || 'Invalid teacher code')
          }

          const payload = (await response.json()) as TeacherAuthResponse
          const queryString = getWindowSearch()
          const targetSessionId = payload.sessionId || startedSessionId
          const path = await resolveTeacherManagePath(activityName, targetSessionId, queryString)
          void navigate(path, { replace: true })
        } catch (authError) {
          setTeacherAuthError(authError instanceof Error ? authError.message : String(authError))
          setIsAuthenticatingTeacher(false)
        }
      }

      const handleStudentJoin = () => {
        void navigate(`/${persistentSessionInfo.sessionId}`, { replace: true })
      }

      return (
        <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg lg:p-6 border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-800 mb-3 text-center">Session is already running</h1>
          <p className="text-gray-700 text-center mb-6">
            Join the session now or log in as a teacher to open the manage dashboard.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                if (!showTeacherAuth) {
                  setShowTeacherAuth(true)
                }
                setTeacherAuthError('')
              }}
            >
              Join as Teacher
            </Button>
            <Button type="button" onClick={handleStudentJoin}>
              Join Session
            </Button>
          </div>

          {showTeacherAuth && (
            <form onSubmit={handleTeacherLogin} className="space-y-4 mt-6 border-t border-gray-200 pt-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-700">Teacher Code</label>
                <input
                  type="password"
                  value={teacherCode}
                  onChange={(event) => setTeacherCode(event.target.value)}
                  className="border-2 border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="Enter teacher code"
                  autoComplete="off"
                  required
                  disabled={isAuthenticatingTeacher}
                />
                {teacherAuthError && <p className="text-sm text-red-600">{teacherAuthError}</p>}
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={!teacherCode.trim() || isAuthenticatingTeacher}>
                  {isAuthenticatingTeacher ? 'Verifying...' : 'Manage Session'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )
    }

    return (
      <WaitingRoom
        activityName={activityName}
        hash={hash}
        hasTeacherCookie={Boolean(persistentSessionInfo?.hasTeacherCookie)}
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

  if (!sessionId) {
    const soloActivities = getSoloActivities(activities)

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

        {soloActivities.length > 0 && (
          <div className="w-full border-t-2 border-gray-300 pt-8">
            <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">Solo Bits</h2>
            <p className="text-center text-gray-600 mb-6">Practice on your own</p>
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {soloActivities.map((activity) => {
                const soloTitle = activity.soloModeMeta?.title || activity.name
                const soloDescription = activity.soloModeMeta?.description || activity.description

                return (
                  <div
                    key={activity.id}
                    onClick={() => navigate(`/solo/${activity.id}`)}
                    className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer h-full flex flex-col"
                  >
                    <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-3`}>
                      <h3 className="text-xl font-semibold">{soloTitle}</h3>
                    </div>
                    <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4 flex-1`}>
                      <p className="text-gray-600">{soloDescription}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

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
      <SessionStudentComponent sessionData={sessionData} persistentSessionInfo={persistentSessionInfo} />
    </Suspense>
  )
}

export default SessionRouter
