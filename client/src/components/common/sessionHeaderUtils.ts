export function isEmbeddedChildSessionId(sessionId?: string): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith('CHILD:')
}
