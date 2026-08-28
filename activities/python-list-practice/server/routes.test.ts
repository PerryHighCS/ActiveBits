import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionStore, type SessionRecord } from 'activebits-server/core/sessions.js'
import { storeSessionEntryParticipant } from 'activebits-server/core/sessionEntryParticipants.js'
import { acceptEntryParticipant, enableParticipantCookieAuthentication, getSessionParticipantCookieName, issueAcceptedEntryParticipantToken } from 'activebits-server/core/acceptedEntryParticipants.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupPythonListPracticeRoutes from './routes.js'

type Handler = (req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> }, res: Response) => Promise<void> | void
interface Response { statusCode: number; body: unknown; status(code: number): Response; json(value: unknown): Response }
function response(): Response { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } } }

void test('Python List Practice preserves pending entry handoffs during session normalization', async () => {
  const session: SessionRecord = { id: 'pending-entry', type: 'python-list-practice', created: 1, lastActivity: 1, data: {} }
  const { token } = storeSessionEntryParticipant(session, { participantId: 'student-1', displayName: 'Ada' })
  const sessions = createSessionStore(null)
  await sessions.set(session.id, session)

  const storedData = (await sessions.get(session.id))?.data as { entryParticipants?: Record<string, unknown> }
  assert.notEqual(storedData.entryParticipants?.[token], undefined)
  await sessions.close()
})

void test('stats require the participant cookie for token-backed Python List Practice sessions', async () => {
  const session: SessionRecord = {
    id: 's1', type: 'python-list-practice', created: 1, lastActivity: 1,
    data: { selectedQuestionTypes: ['all'], students: [{ id: 'student-1', name: 'Ada', connected: true, lastSeen: 1, stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 } }] },
  }
  enableParticipantCookieAuthentication(session)
  acceptEntryParticipant(session, { participantId: 'student-1', displayName: 'Ada' })
  const token = issueAcceptedEntryParticipantToken(session, 'student-1')
  if (!token) throw new Error('Expected participant token')
  const sessions = createSessionStore(null)
  await sessions.set(session.id, session)
  const handlers: Record<string, Handler> = {}
  const app = { get() {}, post(path: string, handler: Handler) { handlers[path] = handler } }
  const ws: WsRouter = { wss: { clients: new Set(), close() {} }, register() {} }
  setupPythonListPracticeRoutes(app, sessions, ws)
  const handler = handlers['/api/python-list-practice/:sessionId/stats']
  assert.ok(handler)
  const payload = { studentId: 'student-1', stats: { total: 1, correct: 1, streak: 1, longestStreak: 1 } }
  console.log('[TEST] expecting 400 for a stats request without the participant cookie')
  const denied = response()
  await handler({ params: { sessionId: session.id }, body: payload }, denied)
  assert.equal(denied.statusCode, 400)
  const accepted = response()
  await handler({ params: { sessionId: session.id }, body: { ...payload, studentId: 'forged' }, cookies: { [getSessionParticipantCookieName(session.id)]: token } }, accepted)
  assert.equal(accepted.statusCode, 200)
  await sessions.close()
})
