import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { buildSyncDeckPasscodeKey } from '../shared/authStorage.js'
import { runSyncDeckPresentationPreflight, type SyncDeckPreflightResult } from '../shared/presentationPreflight.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'
import { createConfiguredSyncDeckSession } from '../shared/sessionLaunch.js'

type LaunchState =
  | { phase: 'idle'; detail: string | null }
  | { phase: 'launching'; detail: string }
  | { phase: 'error'; detail: string }

function normalizePreflightWarning(warning: string | null): string {
  const trimmed = typeof warning === 'string' ? warning.trim() : ''
  if (trimmed.length === 0) {
    return 'Presentation did not pass SyncDeck validation.'
  }

  return trimmed.replace(/\s*You can continue anyway\.?\s*$/i, '').trim()
}

export type SyncDeckLaunchMode = 'student' | 'instructor'

interface SyncDeckLaunchStorage {
  setItem(key: string, value: string): void
}

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

function storeInstructorPasscode(params: {
  sessionId: string
  instructorPasscode: string
  storage?: SyncDeckLaunchStorage | null
}): void {
  const storage =
    params.storage
    ?? (typeof window !== 'undefined' ? window.sessionStorage : null)

  try {
    storage?.setItem(buildSyncDeckPasscodeKey(params.sessionId), params.instructorPasscode)
  } catch {
    // The manager can still show a credential error if storage is unavailable.
  }
}

export interface LaunchStandaloneSyncDeckPresentationParams {
  presentationUrl: string
  mode?: SyncDeckLaunchMode
  hostProtocol?: string | null
  userAgent?: string | null
  preflightRunner?: (url: string) => Promise<SyncDeckPreflightResult>
  fetchFn?: typeof fetch
  redirectTo?: (url: string) => void
  storage?: SyncDeckLaunchStorage | null
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

  if (mode === 'instructor') {
    storeInstructorPasscode({
      sessionId,
      instructorPasscode,
      storage: params.storage,
    })
  }

  params.redirectTo?.(buildSyncDeckLaunchRedirect({ mode, sessionId, presentationUrl }))

  return { sessionId }
}

export default function SyncDeckLaunchPresentation() {
  const [searchParams] = useSearchParams()
  const [presentationUrlInput, setPresentationUrlInput] = useState(() => resolveSyncDeckLaunchPresentationUrl(searchParams))
  const launchMode = resolveSyncDeckLaunchMode(searchParams.get('mode'))
  const [launchState, setLaunchState] = useState<LaunchState>(() => {
    const initialPresentationUrl = resolveSyncDeckLaunchPresentationUrl(searchParams)
    return initialPresentationUrl.length > 0
      ? { phase: 'launching', detail: 'Validating presentation...' }
      : { phase: 'idle', detail: null }
  })

  useEffect(() => {
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
          redirectTo: (url) => {
            if (!cancelled) {
              setLaunchState({
                phase: 'launching',
                detail: mode === 'instructor'
                  ? 'Starting instructor SyncDeck session...'
                  : 'Starting standalone SyncDeck session...',
              })
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
  }, [searchParams])

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
          redirectTo: (url) => {
            setLaunchState({
              phase: 'launching',
              detail: launchMode === 'instructor'
                ? 'Starting instructor SyncDeck session...'
                : 'Starting standalone SyncDeck session...',
            })
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

  const isLaunching = launchState.phase === 'launching'
  const showForm = launchState.phase !== 'launching'

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
