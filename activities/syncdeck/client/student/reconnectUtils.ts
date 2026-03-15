export interface SyncDeckReconnectCloseDecision {
  clearCachedIdentity: boolean
  joinError: string | null
  statusMessage: string
}

const REJOIN_REQUIRED_MESSAGE = 'Please re-enter your name to rejoin this presentation.'
const REJOIN_REQUIRED_STATUS = 'Reconnect required before instructor sync can resume.'
const DEFAULT_DISCONNECTED_STATUS = 'Reconnecting to instructor sync…'

export function resolveSyncDeckStudentCloseDecision(event: { code?: number; reason?: string }): SyncDeckReconnectCloseDecision {
  if (
    event.code === 1008
    && (event.reason === 'missing studentId' || event.reason === 'unregistered student')
  ) {
    return {
      clearCachedIdentity: true,
      joinError: REJOIN_REQUIRED_MESSAGE,
      statusMessage: REJOIN_REQUIRED_STATUS,
    }
  }

  return {
    clearCachedIdentity: false,
    joinError: null,
    statusMessage: DEFAULT_DISCONNECTED_STATUS,
  }
}
