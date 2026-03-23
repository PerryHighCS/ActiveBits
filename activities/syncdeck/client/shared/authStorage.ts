export const SYNCDECK_PASSCODE_KEY_PREFIX = 'syncdeck_instructor_'

export function buildSyncDeckPasscodeKey(sessionId: string): string {
  return `${SYNCDECK_PASSCODE_KEY_PREFIX}${sessionId}`
}
