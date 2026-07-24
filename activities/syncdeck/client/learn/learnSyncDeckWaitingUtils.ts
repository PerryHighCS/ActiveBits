interface WaitingStatusResponse {
  state?: unknown
  studentLaunchUrl?: unknown
  error?: unknown
}

export interface TimedAbortRequest {
  controller: AbortController
  cancelTimeout: () => void
}

type BrowserTimers = Pick<Window, 'setTimeout' | 'clearTimeout'>

export function createTimedAbortRequest(
  timeoutMs: number,
  timers: BrowserTimers = window,
): TimedAbortRequest {
  const controller = new AbortController()
  const timeout = timers.setTimeout(() => controller.abort(), timeoutMs)

  return {
    controller,
    cancelTimeout: () => timers.clearTimeout(timeout),
  }
}

function isSameOriginRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
}

export async function readLearnSyncDeckWaitingStatus(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ state: 'waiting' | 'active'; studentLaunchUrl: string | null }> {
  const response = await fetchImpl('/api/integrations/learn/v1/activities/syncdeck/wait/status', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  })
  let payload: WaitingStatusResponse = {}
  try {
    payload = await response.json() as WaitingStatusResponse
  } catch {
    // Proxies and upstream errors may return a non-JSON response.
  }
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Your waiting-room entry is no longer available.')
  }
  return {
    state: payload.state === 'active' ? 'active' : 'waiting',
    studentLaunchUrl: isSameOriginRelativePath(payload.studentLaunchUrl) && payload.studentLaunchUrl.length > 0
      ? payload.studentLaunchUrl
      : null,
  }
}
