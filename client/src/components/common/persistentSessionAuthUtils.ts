import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'

export interface PersistentSessionAuthErrorResponse {
  error?: string
  code?: string
  entryPolicy?: PersistentSessionEntryPolicy
  sessionId?: string | null
}

export interface PersistentSessionAuthFailure {
  message: string
  isEntryPolicyRejected: boolean
  entryPolicy?: PersistentSessionEntryPolicy
}

export function resolvePersistentSessionAuthFailure(
  payload: PersistentSessionAuthErrorResponse | null | undefined,
  fallbackMessage = 'Invalid teacher code',
): PersistentSessionAuthFailure {
  const message = typeof payload?.error === 'string' && payload.error.trim().length > 0
    ? payload.error
    : fallbackMessage

  const entryPolicy = payload?.entryPolicy
  const isEntryPolicyRejected = payload?.code === 'entry-policy-rejected' && entryPolicy === 'solo-only'

  return {
    message,
    isEntryPolicyRejected,
    entryPolicy,
  }
}
