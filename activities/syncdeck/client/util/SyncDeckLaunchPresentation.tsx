import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { runSyncDeckPresentationPreflight, type SyncDeckPreflightResult } from '../shared/presentationPreflight.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'
import { createConfiguredSyncDeckSession } from '../shared/sessionLaunch.js'

type LaunchState =
  | { phase: 'idle'; detail: string | null }
  | { phase: 'launching'; detail: string }
  | { phase: 'error'; detail: string }

type PermalinkState =
  | { phase: 'idle'; detail: string | null; permalink: string | null }
  | { phase: 'verifying'; detail: string; permalink: string | null }
  | { phase: 'verified'; detail: string; permalink: string | null }
  | { phase: 'creating'; detail: string; permalink: string | null }
  | { phase: 'created'; detail: string; permalink: string }
  | { phase: 'error'; detail: string; permalink: string | null }

type CopyState =
  | { phase: 'idle'; detail: string | null }
  | { phase: 'copying'; detail: string }
  | { phase: 'copied'; detail: string }
  | { phase: 'error'; detail: string }

function normalizePreflightWarning(warning: string | null): string {
  const trimmed = typeof warning === 'string' ? warning.trim() : ''
  if (trimmed.length === 0) {
    return 'Presentation did not pass SyncDeck validation.'
  }

  return trimmed.replace(/\s*You can continue anyway\.?\s*$/i, '').trim()
}

export type SyncDeckLaunchMode = 'student' | 'instructor'

export function resolveSyncDeckLaunchMode(value: string | null | undefined): SyncDeckLaunchMode {
  return value === 'instructor' ? 'instructor' : 'student'
}

export function resolveSyncDeckLaunchPresentationUrl(searchParams: URLSearchParams): string {
  return (
    searchParams.get('presentationUrl')
    ?? searchParams.get('presentation-url')
    ?? ''
  ).trim()
}

function buildSyncDeckLaunchRedirect(params: {
  mode: SyncDeckLaunchMode
  sessionId: string
  presentationUrl: string
}): string {
  if (params.mode === 'instructor') {
    const query = new URLSearchParams({ presentationUrl: params.presentationUrl })
    return `/manage/syncdeck/${encodeURIComponent(params.sessionId)}?${query.toString()}`
  }

  return `/${encodeURIComponent(params.sessionId)}`
}

export interface LaunchStandaloneSyncDeckPresentationParams {
  presentationUrl: string
  mode?: SyncDeckLaunchMode
  hostProtocol?: string | null
  userAgent?: string | null
  preflightRunner?: (url: string) => Promise<SyncDeckPreflightResult>
  fetchFn?: typeof fetch
  redirectTo?: (url: string, state?: SyncDeckLaunchRedirectState) => void
}

export interface SyncDeckLaunchRedirectState {
  createSessionPayload?: {
    instructorPasscode: string
  }
}

export interface GenerateSyncDeckPermalinkParams {
  presentationUrl: string
  teacherCode: string
  fetchFn?: typeof fetch
  origin?: string
}

export interface GenerateSyncDeckPermalinkResult {
  hash: string
  permalink: string
}

export async function copyTextToClipboard(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | null | undefined = typeof navigator !== 'undefined'
    ? navigator.clipboard
    : undefined,
): Promise<void> {
  const value = text.trim()
  if (value.length === 0) {
    throw new Error('Nothing to copy.')
  }
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    throw new Error('Clipboard copy is unavailable in this browser.')
  }

  await clipboard.writeText(value)
}

function isSyncDeckPermalinkUtilityPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/util/syncdeck/permalink'
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown }
    return typeof payload.error === 'string' && payload.error.trim().length > 0
      ? payload.error
      : fallback
  } catch {
    return fallback
  }
}

export async function generateSyncDeckPermalink(
  params: GenerateSyncDeckPermalinkParams,
): Promise<GenerateSyncDeckPermalinkResult> {
  const presentationUrl = params.presentationUrl.trim()
  const teacherCode = params.teacherCode.trim()
  if (presentationUrl.length === 0) {
    throw new Error('Presentation URL is required.')
  }
  if (teacherCode.length === 0) {
    throw new Error('Teacher code is required.')
  }

  const fetchFn = params.fetchFn ?? fetch
  const response = await fetchFn('/api/syncdeck/generate-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      activityName: 'syncdeck',
      teacherCode,
      selectedOptions: {
        presentationUrl,
      },
    }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Unable to generate SyncDeck permalink.'))
  }

  const payload = (await response.json()) as { hash?: unknown; url?: unknown }
  if (typeof payload.hash !== 'string' || payload.hash.length === 0 || typeof payload.url !== 'string' || payload.url.length === 0) {
    throw new Error('Unable to generate SyncDeck permalink.')
  }

  const origin = params.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://bits.mycode.run')
  return {
    hash: payload.hash,
    permalink: new URL(payload.url, origin).toString(),
  }
}

export async function launchStandaloneSyncDeckPresentation(
  params: LaunchStandaloneSyncDeckPresentationParams,
): Promise<{ sessionId: string }> {
  const presentationUrl = params.presentationUrl.trim()
  const mode = params.mode ?? 'student'
  if (presentationUrl.length === 0) {
    throw new Error('Presentation URL is required.')
  }

  const compatibilityError = getStudentPresentationCompatibilityError({
    value: presentationUrl,
    hostProtocol: params.hostProtocol,
    userAgent: params.userAgent,
  })
  if (compatibilityError != null) {
    throw new Error(compatibilityError)
  }

  const preflightRunner = params.preflightRunner ?? runSyncDeckPresentationPreflight
  const preflightResult = await preflightRunner(presentationUrl)
  if (!preflightResult.valid) {
    throw new Error(normalizePreflightWarning(preflightResult.warning))
  }

  const { sessionId, instructorPasscode } = await createConfiguredSyncDeckSession({
    presentationUrl,
    standaloneMode: mode !== 'instructor',
    fetchFn: params.fetchFn,
  })

  const redirectState = mode === 'instructor'
    ? {
        createSessionPayload: {
          instructorPasscode,
        },
      } satisfies SyncDeckLaunchRedirectState
    : undefined

  params.redirectTo?.(buildSyncDeckLaunchRedirect({ mode, sessionId, presentationUrl }), redirectState)

  return { sessionId }
}

export default function SyncDeckLaunchPresentation() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isPermalinkUtility = isSyncDeckPermalinkUtilityPath(location.pathname)
  const [presentationUrlInput, setPresentationUrlInput] = useState(() => resolveSyncDeckLaunchPresentationUrl(searchParams))
  const launchMode = resolveSyncDeckLaunchMode(searchParams.get('mode'))
  const [launchState, setLaunchState] = useState<LaunchState>(() => {
    const initialPresentationUrl = resolveSyncDeckLaunchPresentationUrl(searchParams)
    return initialPresentationUrl.length > 0
      ? { phase: 'launching', detail: 'Validating presentation...' }
      : { phase: 'idle', detail: null }
  })
  const [teacherCode, setTeacherCode] = useState('')
  const [permalinkState, setPermalinkState] = useState<PermalinkState>({
    phase: 'idle',
    detail: null,
    permalink: null,
  })
  const [copyState, setCopyState] = useState<CopyState>({
    phase: 'idle',
    detail: null,
  })

  useEffect(() => {
    if (isPermalinkUtility) {
      return undefined
    }

    let cancelled = false
    const presentationUrl = resolveSyncDeckLaunchPresentationUrl(searchParams)
    const mode = resolveSyncDeckLaunchMode(searchParams.get('mode'))
    if (presentationUrl.length === 0) {
      setPresentationUrlInput('')
      setLaunchState({
        phase: 'idle',
        detail: null,
      })
      return
    }

    setPresentationUrlInput(presentationUrl)
    setLaunchState({
      phase: 'launching',
      detail: 'Validating presentation...',
    })

    void (async () => {
      try {
        await launchStandaloneSyncDeckPresentation({
          presentationUrl,
          mode,
          hostProtocol: window.location.protocol,
          userAgent: window.navigator.userAgent,
          redirectTo: (url, state) => {
            if (!cancelled) {
              setLaunchState({
                phase: 'launching',
                detail: mode === 'instructor'
                  ? 'Starting instructor SyncDeck session...'
                  : 'Starting standalone SyncDeck session...',
              })
              if (state) {
                void navigate(url, { state })
                return
              }
              window.location.assign(url)
            }
          },
        })
      } catch (error) {
        if (!cancelled) {
          const detail = error instanceof Error ? error.message : 'Unable to launch this presentation in SyncDeck.'
          setLaunchState({
            phase: 'error',
            detail,
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isPermalinkUtility, navigate, searchParams])

  useEffect(() => {
    if (!isPermalinkUtility) {
      return
    }

    setPresentationUrlInput(resolveSyncDeckLaunchPresentationUrl(searchParams))
    setPermalinkState({
      phase: 'idle',
      detail: null,
      permalink: null,
    })
    setCopyState({
      phase: 'idle',
      detail: null,
    })
  }, [isPermalinkUtility, searchParams])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const presentationUrl = presentationUrlInput.trim()
    if (presentationUrl.length === 0) {
      setLaunchState({
        phase: 'error',
        detail: 'Presentation URL is required.',
      })
      return
    }

    setLaunchState({
      phase: 'launching',
      detail: 'Validating presentation...',
    })

    void (async () => {
      try {
        await launchStandaloneSyncDeckPresentation({
          presentationUrl,
          mode: launchMode,
          hostProtocol: window.location.protocol,
          userAgent: window.navigator.userAgent,
          redirectTo: (url, state) => {
            setLaunchState({
              phase: 'launching',
              detail: launchMode === 'instructor'
                ? 'Starting instructor SyncDeck session...'
                : 'Starting standalone SyncDeck session...',
            })
            if (state) {
              void navigate(url, { state })
              return
            }
            window.location.assign(url)
          },
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unable to launch this presentation in SyncDeck.'
        setLaunchState({
          phase: 'error',
          detail,
        })
      }
    })()
  }

  const handleVerifyPermalinkUrl = (): void => {
    const presentationUrl = presentationUrlInput.trim()
    if (presentationUrl.length === 0) {
      setPermalinkState({
        phase: 'error',
        detail: 'Presentation URL is required.',
        permalink: null,
      })
      return
    }

    const compatibilityError = getStudentPresentationCompatibilityError({
      value: presentationUrl,
      hostProtocol: typeof window !== 'undefined' ? window.location.protocol : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    if (compatibilityError != null) {
      setPermalinkState({
        phase: 'error',
        detail: compatibilityError,
        permalink: null,
      })
      return
    }

    setPermalinkState({
      phase: 'verifying',
      detail: 'Validating presentation...',
      permalink: null,
    })

    void (async () => {
      try {
        const preflightResult = await runSyncDeckPresentationPreflight(presentationUrl)
        if (!preflightResult.valid) {
          throw new Error(normalizePreflightWarning(preflightResult.warning))
        }
        setPermalinkState({
          phase: 'verified',
          detail: 'URL verified. Add a teacher code to create the permanent link.',
          permalink: null,
        })
      } catch (error) {
        setPermalinkState({
          phase: 'error',
          detail: error instanceof Error ? error.message : 'Unable to verify this presentation URL.',
          permalink: null,
        })
      }
    })()
  }

  const handlePermalinkSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const presentationUrl = presentationUrlInput.trim()
    const normalizedTeacherCode = teacherCode.trim()
    if (presentationUrl.length === 0) {
      setPermalinkState({
        phase: 'error',
        detail: 'Presentation URL is required.',
        permalink: null,
      })
      return
    }
    if (normalizedTeacherCode.length === 0) {
      setPermalinkState({
        phase: 'error',
        detail: 'Teacher code is required.',
        permalink: null,
      })
      return
    }

    setPermalinkState({
      phase: 'creating',
      detail: 'Creating permanent SyncDeck link...',
      permalink: null,
    })

    void (async () => {
      try {
        const result = await generateSyncDeckPermalink({
          presentationUrl,
          teacherCode: normalizedTeacherCode,
        })
        setCopyState({
          phase: 'idle',
          detail: null,
        })
        setPermalinkState({
          phase: 'created',
          detail: 'Permanent SyncDeck link created.',
          permalink: result.permalink,
        })
      } catch (error) {
        setPermalinkState({
          phase: 'error',
          detail: error instanceof Error ? error.message : 'Unable to generate SyncDeck permalink.',
          permalink: null,
        })
      }
    })()
  }

  const handleCopyPermalink = (): void => {
    const permalink = permalinkState.permalink
    if (permalink == null) {
      return
    }

    setCopyState({
      phase: 'copying',
      detail: 'Copying link...',
    })

    void (async () => {
      try {
        await copyTextToClipboard(permalink)
        setCopyState({
          phase: 'copied',
          detail: 'Copied link to clipboard.',
        })
      } catch (error) {
        setCopyState({
          phase: 'error',
          detail: error instanceof Error ? error.message : 'Unable to copy link.',
        })
      }
    })()
  }

  const isLaunching = launchState.phase === 'launching'
  const showForm = launchState.phase !== 'launching'

  if (isPermalinkUtility) {
    const isWorking = permalinkState.phase === 'verifying' || permalinkState.phase === 'creating'
    const isVerified = permalinkState.phase === 'verified' || permalinkState.phase === 'created'
    const canCreate = isVerified && teacherCode.trim().length > 0 && !isWorking

    return (
      <main className="min-h-screen bg-slate-950 text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">SyncDeck Utility</p>
            <h1 className="text-4xl font-semibold tracking-tight">Build Permalink</h1>
            <p className="max-w-2xl text-base leading-7 text-slate-300">
              Verify a public presentation URL, then create a permanent SyncDeck link with a teacher code.
            </p>
          </div>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/30">
            <form className="space-y-4" onSubmit={handlePermalinkSubmit}>
              <div>
                <label className="block text-sm font-medium text-slate-200" htmlFor="syncdeck-permalink-presentation-url">
                  Presentation URL
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="syncdeck-permalink-presentation-url"
                    type="url"
                    value={presentationUrlInput}
                    onChange={(event) => {
                      setPresentationUrlInput(event.target.value)
                      setPermalinkState({
                        phase: 'idle',
                        detail: null,
                        permalink: null,
                      })
                      setCopyState({
                        phase: 'idle',
                        detail: null,
                      })
                    }}
                    placeholder="https://slides.example/deck"
                    className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-50 outline-none transition focus:border-cyan-400"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleVerifyPermalinkUrl}
                    disabled={presentationUrlInput.trim().length === 0 || isWorking}
                    className="rounded-full border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                  >
                    {permalinkState.phase === 'verifying' ? 'Verifying...' : 'Verify URL'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200" htmlFor="syncdeck-permalink-teacher-code">
                  Teacher Code
                </label>
                <input
                  id="syncdeck-permalink-teacher-code"
                  type="password"
                  value={teacherCode}
                  onChange={(event) => {
                    setTeacherCode(event.target.value)
                  }}
                  placeholder="At least 6 characters"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-50 outline-none transition focus:border-cyan-400"
                  autoComplete="new-password"
                  required
                />
              </div>

              {permalinkState.detail !== null && (
                <p className={`text-sm leading-6 ${permalinkState.phase === 'error' ? 'text-rose-300' : 'text-cyan-200'}`}>
                  {permalinkState.detail}
                </p>
              )}

              {permalinkState.permalink !== null && (
                <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
                  <p className="text-sm font-semibold text-slate-200">Permanent Link</p>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
                    <a
                      href={permalinkState.permalink}
                      className="min-w-0 flex-1 break-all text-sm text-cyan-200 underline decoration-cyan-500 underline-offset-4"
                    >
                      {permalinkState.permalink}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyPermalink}
                      disabled={copyState.phase === 'copying'}
                      className="shrink-0 rounded-full border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-950 disabled:cursor-wait disabled:border-slate-700 disabled:text-slate-500"
                    >
                      {copyState.phase === 'copying' ? 'Copying...' : copyState.phase === 'copied' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  {copyState.detail !== null && (
                    <p
                      className={`mt-3 text-sm ${copyState.phase === 'error' ? 'text-rose-300' : 'text-cyan-200'}`}
                      role="status"
                    >
                      {copyState.detail}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={!canCreate}
                >
                  {permalinkState.phase === 'creating' ? 'Creating...' : 'Create Permanent Link'}
                </button>
                <Link
                  to="/manage"
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-50"
                >
                  Back to Manage
                </Link>
              </div>
            </form>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">SyncDeck Utility</p>
          <h1 className="text-4xl font-semibold tracking-tight">Launch Presentation</h1>
          <p className="max-w-2xl text-base leading-7 text-slate-300">
            Launch a SyncDeck session from a public presentation URL. ActiveBits validates the
            presentation first, then creates and opens the session on this origin.
          </p>
        </div>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/30">
          <h2 className="text-lg font-medium text-slate-100">
            {isLaunching ? 'Working...' : 'Presentation URL'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {isLaunching
              ? launchState.detail
              : launchMode === 'instructor'
                ? 'Paste the public presentation URL you want ActiveBits to open in a new instructor SyncDeck session.'
                : 'Paste the public presentation URL you want ActiveBits to open in SyncDeck solo mode.'}
          </p>
          {showForm && (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-medium text-slate-200" htmlFor="syncdeck-launch-presentation-url">
                  Presentation URL
                </label>
                <input
                  id="syncdeck-launch-presentation-url"
                  type="url"
                  value={presentationUrlInput}
                  onChange={(event) => {
                    setPresentationUrlInput(event.target.value)
                    if (launchState.phase === 'error') {
                      setLaunchState({ phase: 'idle', detail: null })
                    }
                  }}
                  placeholder="https://slides.example/deck"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-50 outline-none transition focus:border-cyan-400"
                />
              </div>
              {launchState.phase === 'error' && (
                <p className="text-sm leading-6 text-rose-300">{launchState.detail}</p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={presentationUrlInput.trim().length === 0}
                >
                  {launchMode === 'instructor' ? 'Launch Instructor Session' : 'Launch Solo in SyncDeck'}
                </button>
                <Link
                  to="/manage"
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-50"
                >
                  Back to Manage
                </Link>
              </div>
            </form>
          )}
          {isLaunching && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/manage"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-50"
              >
                Back to Manage
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
