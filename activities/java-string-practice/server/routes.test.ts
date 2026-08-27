import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionStore, type SessionRecord } from 'activebits-server/core/sessions.js'
import { acceptEntryParticipant, getSessionParticipantCookieName, issueAcceptedEntryParticipantToken } from 'activebits-server/core/acceptedEntryParticipants.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupJavaStringPracticeRoutes from './routes.js'

type Handler = (req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> }, res: Response) => Promise<void> | void
interface Response { statusCode: number; body: unknown; status(code: number): Response; json(value: unknown): Response }

function response(): Response {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
}

void test('progress requires the participant cookie for token-backed Java String sessions', async () => {
  const session: SessionRecord = {
    id: 's1', type: 'java-string-practice', created: 1, lastActivity: 1,
    data: { students: [{ id: 'student-1', name: 'Ada', connected: true, joined: 1, lastSeen: 1, stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 } }] },
  }
  acceptEntryParticipant(session, { participantId: 'student-1', displayName: 'Ada' })
  const token = issueAcceptedEntryParticipantToken(session, 'student-1')
  if (!token) throw new Error('Expected participant token')
  const sessions = createSessionStore(null)
  await sessions.set(session.id, session)
  const handlers: Record<string, Handler> = {}
  const app = { get() {}, post(path: string, handler: Handler) { handlers[path] = handler } }
  const ws: WsRouter = { wss: { clients: new Set(), close() {} }, register() {} }
  setupJavaStringPracticeRoutes(app, sessions, ws)
  const handler = handlers['/api/java-string-practice/:sessionId/progress']
  assert.ok(handler)
  const payload = { studentId: 'student-1', stats: { total: 1, correct: 1, streak: 1, longestStreak: 1 } }

  const rejected = response()
  await handler({ params: { sessionId: session.id }, body: payload }, rejected)
  assert.equal(rejected.statusCode, 403)

  const accepted = response()
  await handler({ params: { sessionId: session.id }, body: { ...payload, studentId: 'other' }, cookies: { [getSessionParticipantCookieName(session.id)]: token } }, accepted)
  assert.equal(accepted.statusCode, 200)
  assert.equal(((await sessions.get(session.id))?.data as { students: Array<{ stats: { correct: number } }> }).students[0]?.stats.correct, 1)
  await sessions.close()
})
