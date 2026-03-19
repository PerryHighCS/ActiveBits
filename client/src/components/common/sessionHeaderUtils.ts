import { EMBEDDED_CHILD_SESSION_PREFIX } from '../../../../types/session.js'

export function isEmbeddedChildSessionId(sessionId?: string): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith(EMBEDDED_CHILD_SESSION_PREFIX)
}
