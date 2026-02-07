import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { activities } from '@src/activities'
import { arrayToCsv, downloadCsv } from '@src/utils/csvUtils'
import { useClipboard } from '@src/hooks/useClipboard'
import {
  buildPersistentSessionKey,
  buildQueryString,
  buildSoloLink,
  describeSelectedOptions,
  initializeDeepLinkOptions,
  normalizeSelectedOptions,
  parseDeepLinkOptions,
  type DeepLinkSelection,
} from './manageDashboardUtils'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

type DashboardActivity = (typeof activities)[number]

interface PersistentSession {
  activityName: string
  hash: string
  fullUrl: string
  teacherCode?: string
  selectedOptions?: Record<string, unknown>
}

interface PersistentSessionListResponse {
  sessions?: PersistentSession[]
}

interface CreateSessionResponse {
  id?: string
}

interface PersistentLinkCreateResponse {
  error?: string
  url?: string
  hash?: string
}

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

const borderColorClasses: Record<string, string> = {
  blue: 'border-blue-200',
  green: 'border-green-200',
  purple: 'border-purple-200',
  red: 'border-red-200',
  yellow: 'border-yellow-200',
  indigo: 'border-indigo-200',
  orange: 'border-orange-200',
  emerald: 'border-emerald-200',
  sky: 'border-sky-200',
  fuchsia: 'border-fuchsia-200',
  pink: 'border-pink-200',
  rose: 'border-rose-200',
  lime: 'border-lime-200',
  teal: 'border-teal-200',
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

function getWindowOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function getActivityById(activityId: string): DashboardActivity | undefined {
  return activities.find((activity) => activity.id === activityId)
}

function getActivityName(activityId: string): string {
  return getActivityById(activityId)?.name || activityId
}

function getActivityColor(activityId: string): string {
  return getActivityById(activityId)?.color || 'blue'
}

export default function ManageDashboard() {
  const navigate = useNavigate()
  const [showPersistentModal, setShowPersistentModal] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<DashboardActivity | null>(null)
  const [teacherCode, setTeacherCode] = useState('')
  const [persistentUrl, setPersistentUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [persistentSessions, setPersistentSessions] = useState<PersistentSession[]>([])
  const [savedSessions, setSavedSessions] = useState<Record<string, string>>({})
  const [visibleCodes, setVisibleCodes] = useState<Record<string, boolean>>({})
  const { copyToClipboard, isCopied } = useClipboard()
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [showSoloModal, setShowSoloModal] = useState(false)
  const [soloActivity, setSoloActivity] = useState<DashboardActivity | null>(null)
  const [soloOptions, setSoloOptions] = useState<DeepLinkSelection>({})
  const [persistentOptions, setPersistentOptions] = useState<DeepLinkSelection>({})

  const refreshPersistentSessions = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/persistent-session/list')
      const payload = (await response.json()) as PersistentSessionListResponse
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : []

      setPersistentSessions(sessions)
      setSavedSessions((previous) => {
        const next = { ...previous }

        for (const session of sessions) {
          if (typeof session.teacherCode !== 'string') continue
          next[buildPersistentSessionKey(session.activityName, session.hash)] = session.teacherCode
        }

        return next
      })
    } catch (refreshError) {
      console.error('Failed to fetch persistent sessions:', refreshError)
      setSavedSessions((previous) => previous)
    }
  }, [])

  useEffect(() => {
    void refreshPersistentSessions()
  }, [refreshPersistentSessions])

  const createSession = async (activityId: string): Promise<void> => {
    setSessionError(null)

    try {
      const response = await fetch(`/api/${activityId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error('Failed to create session')
      }

      const payload = (await response.json()) as CreateSessionResponse
      if (!payload.id) {
        throw new Error('Failed to create session')
      }

      navigate(`/manage/${activityId}/${payload.id}`)
    } catch (createError) {
      console.error(createError)
      setSessionError('Could not create session. Please try again.')
      setTimeout(() => setSessionError(null), 5000)
    }
  }

  const openPersistentModal = (activity: DashboardActivity): void => {
    setSelectedActivity(activity)
    setShowPersistentModal(true)
    setTeacherCode('')
    setPersistentUrl(null)
    setError(null)
    setPersistentOptions(initializeDeepLinkOptions(activity.deepLinkOptions))
  }

  const closePersistentModal = (): void => {
    setShowPersistentModal(false)
    setSelectedActivity(null)
    setTeacherCode('')
    setPersistentUrl(null)
    setError(null)
    setIsCreating(false)
    setPersistentOptions({})
  }

  const openSoloModal = (activity: DashboardActivity): void => {
    setSoloActivity(activity)
    setSoloOptions(initializeDeepLinkOptions(activity.deepLinkOptions))
    setShowSoloModal(true)
  }

  const closeSoloModal = (): void => {
    setShowSoloModal(false)
    setSoloActivity(null)
    setSoloOptions({})
  }

  const createPersistentLink = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!selectedActivity) {
      setError('No activity selected')
      return
    }

    setError(null)
    setIsCreating(true)

    try {
      const selectedOptions = normalizeSelectedOptions(selectedActivity.deepLinkOptions, persistentOptions)
      const response = await fetch('/api/persistent-session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityName: selectedActivity.id,
          teacherCode: teacherCode.trim(),
          selectedOptions,
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
          // Keep fallback error message if payload is not JSON.
        }

        throw new Error(message)
      }

      const payload = (await response.json()) as PersistentLinkCreateResponse
      if (!payload.url || !payload.hash) {
        throw new Error('Failed to create persistent link')
      }

      const fullUrl = `${getWindowOrigin()}${payload.url}${buildQueryString(selectedOptions)}`
      setPersistentUrl(fullUrl)

      setSavedSessions((previous) => ({
        ...previous,
        [buildPersistentSessionKey(selectedActivity.id, payload.hash as string)]: teacherCode.trim(),
      }))

      await refreshPersistentSessions()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setIsCreating(false)
    }
  }

  const downloadPersistentLinksCSV = (): void => {
    const headers = ['Activity', 'Teacher Code', 'URL']
    const rows = persistentSessions.map((session) => {
      const sessionKey = buildPersistentSessionKey(session.activityName, session.hash)
      return [
        getActivityName(session.activityName),
        savedSessions[sessionKey] || '',
        `${session.fullUrl}${buildQueryString(session.selectedOptions)}`,
      ]
    })

    const csvContent = arrayToCsv([headers, ...rows])
    downloadCsv(csvContent, 'permanent-links')
  }

  const toggleCodeVisibility = (sessionKey: string): void => {
    setVisibleCodes((previous) => ({
      ...previous,
      [sessionKey]: !previous[sessionKey],
    }))
  }

  const getSoloLink = (activityId: string, options: Record<string, unknown> = {}): string =>
    buildSoloLink(getWindowOrigin(), activityId, options)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {sessionError && (
        <div className="mb-4 bg-red-50 border-2 border-red-200 rounded p-3">
          <p className="text-red-700 font-semibold">{sessionError}</p>
        </div>
      )}

      <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">Activity Dashboard</h1>
      <p className="text-center text-gray-600 mb-8">Choose an activity to start a new session</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {activities.map((activity) => {
          const soloLink = getSoloLink(activity.id)
          const deepLinkOptions = parseDeepLinkOptions(activity.deepLinkOptions)
          const hasDeepLinkOptions = Object.keys(deepLinkOptions).length > 0

          return (
            <div
              key={activity.id}
              className="rounded-lg shadow-md overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all flex flex-col h-full"
            >
              <div className={`${colorClasses[activity.color] || 'bg-gray-600'} text-white px-6 py-4`}>
                <h3 className="text-xl font-semibold">{activity.name}</h3>
              </div>
              <div className={`${bgColorClasses[activity.color] || 'bg-gray-50'} px-6 py-4 flex flex-col h-full`}>
                <p className="text-gray-600 mb-4">{activity.description}</p>
                <div className="flex-1" />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      void createSession(activity.id)
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                  >
                    Start Session Now
                  </button>
                  <button
                    onClick={() => openPersistentModal(activity)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                  >
                    Create Permanent Link
                  </button>
                  {activity.soloMode && (
                    <button
                      onClick={() => {
                        if (hasDeepLinkOptions) {
                          openSoloModal(activity)
                        } else {
                          void copyToClipboard(soloLink)
                        }
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded transition-colors"
                    >
                      {(() => {
                        const label = activity.soloModeMeta?.buttonText || 'Copy Solo Practice Link'
                        if (hasDeepLinkOptions) return label
                        if (!isCopied(soloLink)) return label
                        const trimmed = label.replace(/^Copy\s+/i, '')
                        return `✓ Copied ${trimmed || 'Solo Link'}`
                      })()}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {persistentSessions.length > 0 && (
        <div className="mt-8 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-semibold text-gray-800">Your Permanent Links</h2>
            <Button onClick={downloadPersistentLinksCSV} variant="outline" className="text-sm">
              Download CSV
            </Button>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            These links are stored in your browser cookies. If you clear cookies or use a different browser, you'll
            need to save these URLs elsewhere.
          </p>
          <div className="space-y-2">
            {persistentSessions.map((session, index) => {
              const color = getActivityColor(session.activityName)
              const bgClass = bgColorClasses[color] || 'bg-blue-50'
              const borderClass = borderColorClasses[color] || 'border-blue-200'
              const sessionKey = buildPersistentSessionKey(session.activityName, session.hash)
              const teacherCodeForSession = savedSessions[sessionKey]
              const isVisible = Boolean(visibleCodes[sessionKey])
              const fullSessionUrl = `${session.fullUrl}${buildQueryString(session.selectedOptions)}`
              const optionDescriptions = describeSelectedOptions(
                getActivityById(session.activityName)?.deepLinkOptions,
                session.selectedOptions,
              )

              return (
                <div key={`${sessionKey}-${index}`} className={`flex items-center gap-2 ${bgClass} p-3 rounded border-2 ${borderClass}`}>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-700">{getActivityName(session.activityName)}</p>
                    {optionDescriptions.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">Options: {optionDescriptions.join(', ')}</p>
                    )}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mt-2">
                      <span>Teacher Code:</span>
                      <code className="bg-white px-2 py-1 rounded">
                        {teacherCodeForSession ? (isVisible ? teacherCodeForSession : '•••••••') : '•••••'}
                      </code>
                      {teacherCodeForSession && (
                        <button
                          onClick={() => toggleCodeVisibility(sessionKey)}
                          className="text-blue-600 hover:text-blue-800 underline text-xs"
                          title={isVisible ? 'Hide code' : 'Show code'}
                        >
                          {isVisible ? 'hide' : 'show'}
                        </button>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      void copyToClipboard(fullSessionUrl)
                    }}
                    variant="outline"
                    className="whitespace-nowrap"
                  >
                    {isCopied(fullSessionUrl) ? '✓ Copied URL' : 'Copy URL'}
                  </Button>
                  <Button
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.open(fullSessionUrl, '_blank')
                      }
                    }}
                    variant="outline"
                  >
                    Open
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal open={showPersistentModal} onClose={closePersistentModal} title={`Create Permanent Link - ${selectedActivity?.name}`}>
        {!persistentUrl ? (
          <form onSubmit={createPersistentLink} className="flex flex-col gap-4">
            <p className="text-gray-700">
              Create a permanent URL that you can use in presentations or bookmark. When anyone visits this URL,
              they'll wait until you start the session with your teacher code.
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
                minLength={6}
                required
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 mt-1">Remember this code! You'll need it to start sessions from this link.</p>
            </div>

            {selectedActivity && Object.keys(parseDeepLinkOptions(selectedActivity.deepLinkOptions)).length > 0 && (
              <div className="border-2 border-gray-200 rounded p-3 bg-gray-50">
                <p className="text-sm font-semibold text-gray-700 mb-2">Link options</p>
                <div className="flex flex-col gap-3">
                  {Object.entries(parseDeepLinkOptions(selectedActivity.deepLinkOptions)).map(([key, option]) => (
                    <label key={key} className="text-sm text-gray-700">
                      <span className="block font-semibold mb-1">{option.label || key}</span>
                      {option.type === 'select' ? (
                        <select
                          value={persistentOptions[key] ?? ''}
                          onChange={(event) =>
                            setPersistentOptions((previous) => ({
                              ...previous,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full border-2 border-gray-300 rounded px-3 py-2 bg-white"
                        >
                          {(option.options || []).map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={persistentOptions[key] ?? ''}
                          onChange={(event) =>
                            setPersistentOptions((previous) => ({
                              ...previous,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full border-2 border-gray-300 rounded px-3 py-2"
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</p>}

            <Button type="submit" disabled={isCreating || teacherCode.length < 6}>
              {isCreating ? 'Creating...' : 'Generate Link'}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-green-600 font-semibold">✓ Permanent link created successfully!</p>

            <div className="bg-gray-50 p-4 rounded border-2 border-gray-200">
              <p className="text-sm text-gray-600 mb-2 font-semibold">Your permanent URL:</p>
              <code className="text-sm break-all bg-white p-2 rounded border border-gray-300 block">{persistentUrl}</code>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void copyToClipboard(persistentUrl)
                }}
              >
                {isCopied(persistentUrl) ? '✓ Copied!' : 'Copy to Clipboard'}
              </Button>
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open(persistentUrl, '_blank')
                  }
                }}
                className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors"
              >
                Open in New Tab
              </button>
            </div>

            <p className="text-sm text-gray-600">
              Save this URL! Anyone who visits it will wait for you to start the session with your teacher code.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={showSoloModal}
        onClose={closeSoloModal}
        title={`${soloActivity?.soloModeMeta?.title || soloActivity?.name || 'Solo'} Practice Link`}
      >
        <div className="flex flex-col gap-4">
          {soloActivity && Object.keys(parseDeepLinkOptions(soloActivity.deepLinkOptions)).length > 0 && (
            <div className="border-2 border-gray-200 rounded p-3 bg-gray-50">
              <p className="text-sm font-semibold text-gray-700 mb-2">Link options</p>
              <div className="flex flex-col gap-3">
                {Object.entries(parseDeepLinkOptions(soloActivity.deepLinkOptions)).map(([key, option]) => (
                  <label key={key} className="text-sm text-gray-700">
                    <span className="block font-semibold mb-1">{option.label || key}</span>
                    {option.type === 'select' ? (
                      <select
                        value={soloOptions[key] ?? ''}
                        onChange={(event) =>
                          setSoloOptions((previous) => ({
                            ...previous,
                            [key]: event.target.value,
                          }))
                        }
                        className="w-full border-2 border-gray-300 rounded px-3 py-2 bg-white"
                      >
                        {(option.options || []).map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={soloOptions[key] ?? ''}
                        onChange={(event) =>
                          setSoloOptions((previous) => ({
                            ...previous,
                            [key]: event.target.value,
                          }))
                        }
                        className="w-full border-2 border-gray-300 rounded px-3 py-2"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="bg-gray-50 p-4 rounded border-2 border-gray-200">
            <p className="text-sm text-gray-600 mb-2 font-semibold">Practice URL:</p>
            <code className="text-sm break-all bg-white p-2 rounded border border-gray-300 block">
              {soloActivity ? getSoloLink(soloActivity.id, normalizeSelectedOptions(soloActivity.deepLinkOptions, soloOptions)) : ''}
            </code>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (!soloActivity) return

                const link = getSoloLink(
                  soloActivity.id,
                  normalizeSelectedOptions(soloActivity.deepLinkOptions, soloOptions),
                )
                void copyToClipboard(link)
              }}
            >
              {soloActivity &&
              isCopied(getSoloLink(soloActivity.id, normalizeSelectedOptions(soloActivity.deepLinkOptions, soloOptions)))
                ? '✓ Copied!'
                : 'Copy Link'}
            </Button>
            <button
              onClick={() => {
                if (!soloActivity || typeof window === 'undefined') return

                const link = getSoloLink(
                  soloActivity.id,
                  normalizeSelectedOptions(soloActivity.deepLinkOptions, soloOptions),
                )
                window.open(link, '_blank')
              }}
              className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors"
            >
              Open in New Tab
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
