import { useCallback, useEffect, useRef, useState } from 'react'
import { readLearnSyncDeckWaitingStatus } from './learnSyncDeckWaitingUtils.js'

const WAITING_STATUS_TIMEOUT_MS = 15_000

type WaitingState =
  | { phase: 'waiting'; detail: string }
  | { phase: 'error'; detail: string }

export default function LearnSyncDeckWaitingRoom() {
  const [state, setState] = useState<WaitingState>({ phase: 'waiting', detail: 'Waiting for your instructor to start the session.' })
  const requestInFlight = useRef(false)
  const mounted = useRef(false)
  const activeRequest = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    const controller = new AbortController()
    activeRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort(), WAITING_STATUS_TIMEOUT_MS)
    try {
      const status = await readLearnSyncDeckWaitingStatus(fetch, controller.signal)
      if (!mounted.current) return
      if (status.state === 'active' && status.studentLaunchUrl) {
        window.location.replace(status.studentLaunchUrl)
        return
      }
      setState({ phase: 'waiting', detail: 'Waiting for your instructor to start the session.' })
    } catch (error) {
      if (!mounted.current) return
      setState({
        phase: 'error',
        detail: controller.signal.aborted
          ? 'Unable to check the waiting room. Please try again.'
          : error instanceof Error ? error.message : 'Unable to check the waiting room.',
      })
    } finally {
      window.clearTimeout(timeout)
      if (activeRequest.current === controller) activeRequest.current = null
      requestInFlight.current = false
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const initialTimer = window.setTimeout(() => {
      void refresh()
    }, 0)
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5_000)
    return () => {
      mounted.current = false
      activeRequest.current?.abort()
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [refresh])

  return (
    <main className="mx-auto mt-12 max-w-lg rounded-lg bg-white p-8 text-center shadow" aria-live="polite" aria-busy={state.phase === 'waiting'}>
      <h1 className="text-2xl font-semibold text-gray-900">SyncDeck waiting room</h1>
      <p className="mt-3 text-gray-700">{state.detail}</p>
      {state.phase === 'error' && (
        <button
          type="button"
          className="mt-6 rounded bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
          onClick={() => void refresh()}
        >
          Try again
        </button>
      )}
    </main>
  )
}
