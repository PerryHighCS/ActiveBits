export interface ParticipantSocketLike {
  readyState: number
  sessionId?: string | null
  studentId?: string | null
  ignoreDisconnect?: boolean
  close(code?: number, reason?: string): void
}

export function closeDuplicateParticipantSockets<TSocket extends ParticipantSocketLike>(
  clients: Iterable<TSocket>,
  currentSocket: TSocket,
): void {
  if (!currentSocket.sessionId || !currentSocket.studentId) {
    return
  }

  for (const client of clients) {
    if (
      client !== currentSocket &&
      client.readyState === 1 &&
      client.sessionId === currentSocket.sessionId &&
      client.studentId === currentSocket.studentId
    ) {
      client.ignoreDisconnect = true
      try {
        client.close(4000, 'Replaced by new connection')
      } catch (error) {
        console.error('Failed to close duplicate participant socket', error)
      }
    }
  }
}
