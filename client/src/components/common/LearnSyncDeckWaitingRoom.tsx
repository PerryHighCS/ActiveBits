import { useCallback, useEffect, useState } from 'react'
import { readLearnSyncDeckWaitingStatus } from './learnSyncDeckWaitingUtils.js'

type WaitingState =
  | { phase: 'waiting'; detail: string }
  | { phase: 'error'; detail: string }

export default function LearnSyncDeckWaitingRoom() {
  const [state, setState] = useState<WaitingState>({ phase: 'waiting', detail: 'Waiting for your instructor to start the session.' })

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await readLearnSyncDeckWaitingStatus()
      if (status.state === 'active' && status.studentLaunchUrl) {
        window.location.replace(status.studentLaunchUrl)
        return
      }
      setState({ phase: 'waiting', detail: 'Waiting for your instructor to start the session.' })
    } catch (error) {
      setState({
        phase: 'error',
        detail: error instanceof Error ? error.message : 'Unable to check the waiting room.',
      })
    }
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refresh()
    }, 0)
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [refresh])

  return (
    <main className="mx-auto mt-12 max-w-lg rounded-lg bg-white p-8 text-center shadow" aria-live="polite">
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
