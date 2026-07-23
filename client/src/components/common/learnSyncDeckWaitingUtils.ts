interface WaitingStatusResponse {
  state?: unknown
  studentLaunchUrl?: unknown
  error?: unknown
}

export async function readLearnSyncDeckWaitingStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<{ state: 'waiting' | 'active'; studentLaunchUrl: string | null }> {
  const response = await fetchImpl('/api/integrations/learn/v1/activities/syncdeck/wait/status', {
    cache: 'no-store',
    credentials: 'same-origin',
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
    studentLaunchUrl: typeof payload.studentLaunchUrl === 'string' && payload.studentLaunchUrl.length > 0
      ? payload.studentLaunchUrl
      : null,
  }
}
