import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { runSyncDeckPresentationPreflight, type SyncDeckPreflightResult } from '../shared/presentationPreflight.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'
import { createConfiguredSyncDeckSession } from '../shared/sessionLaunch.js'

type LaunchState =
  | { phase: 'launching'; detail: string }
  | { phase: 'error'; detail: string }

function normalizePreflightWarning(warning: string | null): string {
  const trimmed = typeof warning === 'string' ? warning.trim() : ''
  if (trimmed.length === 0) {
    return 'Presentation did not pass SyncDeck validation.'
  }

  return trimmed.replace(/\s*You can continue anyway\.?\s*$/i, '').trim()
}

function buildSyncDeckPasscodeKey(sessionId: string): string {
  return `syncdeck_instructor_${sessionId}`
}

export interface LaunchHostedSyncDeckPresentationParams {
  presentationUrl: string
  hostProtocol?: string | null
  userAgent?: string | null
  preflightRunner?: (url: string) => Promise<SyncDeckPreflightResult>
  fetchFn?: typeof fetch
  sessionStorage?: Pick<Storage, 'setItem'> | null
  redirectTo?: (url: string) => void
}

export async function launchHostedSyncDeckPresentation(
  params: LaunchHostedSyncDeckPresentationParams,
): Promise<{ sessionId: string }> {
  const presentationUrl = params.presentationUrl.trim()
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
    standaloneMode: false,
    fetchFn: params.fetchFn,
  })

  params.sessionStorage?.setItem(buildSyncDeckPasscodeKey(sessionId), instructorPasscode)
  params.redirectTo?.(`/manage/syncdeck/${encodeURIComponent(sessionId)}`)

  return { sessionId }
}

export default function SyncDeckLaunchPresentation() {
  const [searchParams] = useSearchParams()
  const [launchState, setLaunchState] = useState<LaunchState>({
    phase: 'launching',
    detail: 'Validating presentation...',
  })

  useEffect(() => {
    let cancelled = false
    const presentationUrl = searchParams.get('presentationUrl')?.trim() ?? ''
    if (presentationUrl.length === 0) {
      setLaunchState({
        phase: 'error',
        detail: 'Missing required presentationUrl query parameter.',
      })
      return
    }

    setLaunchState({
      phase: 'launching',
      detail: 'Validating presentation...',
    })

    void (async () => {
      try {
        await launchHostedSyncDeckPresentation({
          presentationUrl,
          hostProtocol: window.location.protocol,
          userAgent: window.navigator.userAgent,
          sessionStorage: window.sessionStorage,
          redirectTo: (url) => {
            if (!cancelled) {
              setLaunchState({
                phase: 'launching',
                detail: 'Starting SyncDeck session...',
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">SyncDeck Utility</p>
          <h1 className="text-4xl font-semibold tracking-tight">Launch Presentation</h1>
          <p className="max-w-2xl text-base leading-7 text-slate-300">
            ActiveBits is validating the requested presentation and, if it passes SyncDeck preflight, will start a
            hosted manager session automatically.
          </p>
        </div>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/30">
          <h2 className="text-lg font-medium text-slate-100">
            {launchState.phase === 'launching' ? 'Working...' : 'Unable to launch this presentation'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{launchState.detail}</p>
          {launchState.phase === 'error' && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/manage"
                className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
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
