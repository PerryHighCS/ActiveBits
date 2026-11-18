import type { CommissionedIdeasPhase } from '../../shared/types.js'

/** Minimal Web Storage surface, so tests can supply a throwing or in-memory store. */
export interface CredentialStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** localStorage key for the activity-specific participant token. */
export function participantTokenKey(sessionId: string): string {
  return `ci:${sessionId}:token`
}

/** Reads the stored token; a storage failure reads as "no token". */
export function readParticipantToken(storage: CredentialStorage, sessionId: string): string | null {
  try {
    return storage.getItem(participantTokenKey(sessionId))
  } catch {
    return null
  }
}

/**
 * Saves the token for reload recovery. Returns false when the browser refused the write
 * (quota, privacy mode): registration still succeeded, only reload recovery is lost.
 */
export function saveParticipantToken(storage: CredentialStorage, sessionId: string, token: string): boolean {
  try {
    storage.setItem(participantTokenKey(sessionId), token)
    return true
  } catch {
    return false
  }
}

/** Drops a token the server explicitly refused. Never call this for transient connection failures. */
export function clearParticipantToken(storage: CredentialStorage, sessionId: string): void {
  try {
    storage.removeItem(participantTokenKey(sessionId))
  } catch {
    // Nothing more to do: the in-memory identity is already cleared.
  }
}

/**
 * Notice for a joined student who is not on a team after registration has closed,
 * or null when no notice applies. Registration stays open in every phase, but only
 * presentation and voting still lead to a ballot.
 */
export function lateArrivalNotice(phase: CommissionedIdeasPhase): string | null {
  switch (phase) {
    case 'registration':
      return null
    case 'presentation':
    case 'voting':
      return 'Teams are already formed. Your instructor will place you on a team — you can vote once you’re on one.'
    case 'results':
      return 'Teams are already formed and voting has closed. Your instructor can still place you on a team.'
  }
}
