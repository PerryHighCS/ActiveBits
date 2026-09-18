import { createSessionStore, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import {
  getActivityCapabilityCookieName,
  issueActivityCapability,
} from 'activebits-server/core/activityCapabilities.js'
import {
  acceptEntryParticipant,
  getSessionParticipantCookieName,
  issueAcceptedEntryParticipantToken,
} from 'activebits-server/core/acceptedEntryParticipants.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WsRouter } from '../../../types/websocket.js'
import setupResonanceRoutes, {
  generateImportedQuestionId,
  resolveAnswerabilityErrorMessage,
  resolveSocketStudentId,
  scheduleParticipantCapabilityExpiryClose,
} from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  cookies?: Record<string, unknown>
  headers?: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, unknown>
  ip?: unknown
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
  headers: Record<string, string>
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
  cookie(name: string, value: string, options: Record<string, unknown>): void
  setHeader(name: string, value: string): void
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    cookie(name, value, options) {
      this.cookies.push({ name, value, options })
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

function issueStudentCookies(session: SessionRecord, studentId: string): Record<string, string> {
  const capability = issueActivityCapability(session, 'participant', studentId)
  return {
    [getActivityCapabilityCookieName('participant', session.id)]: capability.token,
  }
}

function createMockApp() {
  const handlers: { get: Record<string, RouteHandler>; post: Record<string, RouteHandler> } = {
    get: {},
    post: {},
  }

  return {
    handlers,
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
  }
}

function createMockWs(): WsRouter {
  return {
    wss: {
      clients: new Set(),
      close() {},
    },
    register() {},
  }
}

function createCapturingMockWs(): {
  ws: WsRouter
  getHandler(): Parameters<WsRouter['register']>[1] | null
} {
  let handler: Parameters<WsRouter['register']>[1] | null = null
  return {
    ws: {
      wss: {
        clients: new Set(),
        close() {},
      },
      register(_path, nextHandler) {
        handler = nextHandler
      },
    },
    getHandler: () => handler,
  }
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.fail('condition was not satisfied')
}

void test('generateImportedQuestionId falls back when Math.random produces an empty suffix', () => {
  assert.equal(
    generateImportedQuestionId(
      new Set(['q1']),
      () => 0,
      () => 1_700_000_000_000,
    ),
    'q_imported_loyw3v28',
  )
})

void test('resolveSocketStudentId rejects student messages that claim another identity', () => {
  assert.equal(resolveSocketStudentId('student2', 'student1'), null)
  assert.equal(resolveSocketStudentId('student1', 'student1'), 'student1')
})

void test('scheduleParticipantCapabilityExpiryClose does not arm a timer for an already-closed socket', () => {
  const now = Date.now()
  const session = {
    id: 'resonance-session-1',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      activityCapabilities: {
        cap1: { id: 'cap1', tokenHash: 'hash', principalKind: 'participant', issuedAt: now, expiresAt: now + 60_000 },
      },
    },
  } as unknown as Parameters<typeof scheduleParticipantCapabilityExpiryClose>[1]

  console.info('[TEST] a closed socket must not have an expiry-close timer armed against it')
  let closeListenerCount = 0
  const closedSocket = {
    readyState: 3,
    close() {},
    on(event: string) {
      if (event === 'close') closeListenerCount += 1
    },
  } as unknown as Parameters<typeof scheduleParticipantCapabilityExpiryClose>[0]
  scheduleParticipantCapabilityExpiryClose(closedSocket, session, 'cap1')
  assert.equal(closeListenerCount, 0, 'a closed socket must not register a close listener or arm a timer')

  let openCloseListenerCount = 0
  const openSocket = {
    readyState: 1,
    close() {},
    on(event: string) {
      if (event === 'close') openCloseListenerCount += 1
    },
  } as unknown as Parameters<typeof scheduleParticipantCapabilityExpiryClose>[0]
  scheduleParticipantCapabilityExpiryClose(openSocket, session, 'cap1')
  assert.equal(openCloseListenerCount, 1, 'an open socket should still arm its expiry-close cleanup')
})

function createEmbeddedResonanceSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'CHILD:syncdeck-parent:abcde:resonance',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      embeddedParentSessionId: 'syncdeck-parent',
      embeddedInstanceKey: 'resonance:2:0',
      embeddedLaunch: {
        parentSessionId: 'syncdeck-parent',
        instanceKey: 'resonance:2:0',
        selectedOptions: {
          questions: [
            {
              id: 'q1',
              type: 'free-response',
              text: 'What is one thing you are still uncertain about?',
              order: 0,
            },
          ],
        },
      },
    },
  }
}

function createInstructorResonanceSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'resonance-session-1',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionRunStartedAt: now - 1_000,
      activeQuestionRunRevision: 1,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 2000 },
        student2: { studentId: 'student2', name: 'Grace Hopper', joinedAt: now - 1500 },
        student3: { studentId: 'student3', name: 'Katherine Johnson', joinedAt: now - 1000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: 1,
          answer: {
            type: 'free-response',
            text: 'I think the loop exits when the counter reaches zero.',
          },
        },
      ],
      responseDrafts: {
        'q1:student2': {
          questionId: 'q1',
          studentId: 'student2',
          updatedAt: now - 100,
          activeQuestionRunRevision: 1,
          answer: {
            type: 'free-response',
            text: 'Still working through the condition...',
          },
        },
      },
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
}

function createMultiQuestionSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'resonance-session-multi',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
          responseTimeLimitMs: 30_000,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which option best fits?',
          order: 1,
          responseTimeLimitMs: 45_000,
          options: [
            { id: 'q2_a', text: 'Option A' },
            { id: 'q2_b', text: 'Option B' },
          ],
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 2_000 },
      },
      responses: [],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
}

void test('embedded resonance sessions receive a stable instructor passcode during normalization', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const storedAgain = await sessions.get(session.id)
  const firstPasscode = (stored?.data as { instructorPasscode?: string } | undefined)?.instructorPasscode ?? null
  const secondPasscode = (storedAgain?.data as { instructorPasscode?: string } | undefined)?.instructorPasscode ?? null
  const questions = (stored?.data as { questions?: Array<{ id?: string; type?: string }> } | undefined)?.questions ?? []

  assert.ok(firstPasscode)
  assert.match(firstPasscode, /^[A-Z0-9]{8}$/)
  assert.equal(secondPasscode, firstPasscode)
  assert.equal(questions.length, 1)
  assert.equal(questions[0]?.id, 'q1')
  assert.equal(questions[0]?.type, 'free-response')

  await sessions.close()
})

void test('resolveAnswerabilityErrorMessage distinguishes staged submission failure reasons', () => {
  assert.equal(resolveAnswerabilityErrorMessage('expired'), 'time is up for this question')
  assert.equal(resolveAnswerabilityErrorMessage('inactive'), 'question is not active')
  assert.equal(resolveAnswerabilityErrorMessage('choices-hidden'), 'choices have not been revealed')
})

void test('student registration issues an httpOnly capability and REST routes enforce its identity', async () => {
  initializePersistentStorage(null)
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())

  const registerHandler = app.handlers.post['/api/resonance/:sessionId/register-student']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  const registerRes = createResponse()
  await registerHandler?.(
    { params: { sessionId: session.id }, body: { name: 'New Student' } },
    registerRes,
  )

  assert.equal(registerRes.statusCode, 200)
  const registeredStudentId = (registerRes.body as { studentId?: string }).studentId
  assert.ok(registeredStudentId)
  assert.equal(registerRes.cookies.length, 1)
  assert.equal(registerRes.cookies[0]?.options.httpOnly, true)
  assert.equal(registerRes.cookies[0]?.options.sameSite, 'lax')
  assert.equal(registerRes.headers['Cache-Control'], 'no-store')
  const authenticatedCookies = {
    [registerRes.cookies[0]!.name]: registerRes.cookies[0]!.value,
  }

  const capabilityCountBeforeReload = Object.keys(
    ((await sessions.get(session.id))?.data as { activityCapabilities?: Record<string, unknown> })
      .activityCapabilities ?? {},
  ).length
  const reloadRes = createResponse()
  await registerHandler?.({
    params: { sessionId: session.id },
    body: { name: 'New Student', studentId: registeredStudentId },
    cookies: authenticatedCookies,
  }, reloadRes)
  assert.equal(reloadRes.statusCode, 200)
  assert.equal(reloadRes.cookies.length, 0, 'an authenticated reload reuses its existing capability')
  assert.equal(Object.keys(
    ((await sessions.get(session.id))?.data as { activityCapabilities?: Record<string, unknown> })
      .activityCapabilities ?? {},
  ).length, capabilityCountBeforeReload)

  const stateRes = createResponse()
  await stateHandler?.({
    params: { sessionId: session.id },
    query: { studentId: registeredStudentId },
    cookies: authenticatedCookies,
  }, stateRes)
  assert.equal(stateRes.statusCode, 200)

  console.info('[TEST] a capability must not authorize a different student id')
  const mismatchedStateRes = createResponse()
  await stateHandler?.({
    params: { sessionId: session.id },
    query: { studentId: 'student1' },
    cookies: authenticatedCookies,
  }, mismatchedStateRes)
  assert.equal(mismatchedStateRes.statusCode, 403)

  console.info('[TEST] a REST capability must not submit for a different student id')
  const mismatchedSubmitRes = createResponse()
  await submitHandler?.({
    params: { sessionId: session.id },
    cookies: authenticatedCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunStartedAt: null,
      answer: { type: 'free-response', text: 'Not my answer' },
    },
  }, mismatchedSubmitRes)
  assert.equal(mismatchedSubmitRes.statusCode, 403)

  console.info('[TEST] an unauthenticated caller cannot claim an existing student during registration')
  const claimedRegistrationRes = createResponse()
  await registerHandler?.({
    params: { sessionId: session.id },
    body: { name: 'Ada Lovelace', studentId: 'student1' },
  }, claimedRegistrationRes)
  assert.equal(claimedRegistrationRes.statusCode, 403)

  const saturatedSession = await sessions.get(session.id)
  assert.ok(saturatedSession)
  const existingCapabilityCount = Object.keys(
    (saturatedSession.data as { activityCapabilities?: Record<string, unknown> }).activityCapabilities ?? {},
  ).length
  for (let index = existingCapabilityCount; index < 200; index += 1) {
    issueActivityCapability(saturatedSession, 'participant', `capacity-student-${index}`)
  }
  await sessions.set(session.id, saturatedSession)

  console.info('[TEST] registration at participant capability capacity should return 429 without eviction')
  const capacityRes = createResponse()
  await registerHandler?.({
    params: { sessionId: session.id },
    body: { name: 'Capacity Student' },
  }, capacityRes)
  assert.equal(capacityRes.statusCode, 429)

  const stillAuthenticatedRes = createResponse()
  await stateHandler?.({
    params: { sessionId: session.id },
    query: { studentId: registeredStudentId },
    cookies: authenticatedCookies,
  }, stillAuthenticatedRes)
  assert.equal(stillAuthenticatedRes.statusCode, 200)

  await sessions.close()
})

void test('unauthenticated direct registration is rate-limited before it can exhaust participant capabilities', async () => {
  initializePersistentStorage(null)
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())
  const registerHandler = app.handlers.post['/api/resonance/:sessionId/register-student']
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = createResponse()
    await registerHandler?.({ params: { sessionId: session.id }, body: { name: `Direct Student ${attempt}` }, ip: '203.0.113.7' }, response)
    assert.equal(response.statusCode, 200)
  }
  console.info('[TEST] repeated unauthenticated direct registrations must be limited before capability capacity is exhausted')
  const limitedResponse = createResponse()
  await registerHandler?.({ params: { sessionId: session.id }, body: { name: 'One Too Many' }, ip: '203.0.113.7' }, limitedResponse)
  assert.equal(limitedResponse.statusCode, 429)
  assert.equal(limitedResponse.headers['Retry-After'], '60')
  assert.equal(Object.keys(((await sessions.get(session.id))?.data as { activityCapabilities?: Record<string, unknown> }).activityCapabilities ?? {}).length, 100)
  await sessions.close()
})

void test('a fresh accepted participant takes precedence over a stale capability from a shared browser', async () => {
  initializePersistentStorage(null)
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  const staleCapabilityCookies = issueStudentCookies(session, 'student1')
  assert.ok(acceptEntryParticipant(session, { participantId: 'student2', displayName: 'Grace Hopper' }))
  const acceptedToken = issueAcceptedEntryParticipantToken(session, 'student2')
  assert.ok(acceptedToken)
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())

  const registerHandler = app.handlers.post['/api/resonance/:sessionId/register-student']
  const response = createResponse()
  await registerHandler?.({
    params: { sessionId: session.id },
    body: { name: 'Grace Hopper', studentId: 'student2' },
    cookies: {
      ...staleCapabilityCookies,
      [getSessionParticipantCookieName(session.id)]: acceptedToken,
    },
  }, response)
  assert.equal(response.statusCode, 200)
  assert.equal((response.body as { studentId?: string }).studentId, 'student2')
  assert.equal(response.cookies.length, 1, 'the accepted participant receives its own replacement capability')

  const capabilityCountAfterRegistration = Object.keys(
    ((await sessions.get(session.id))?.data as { activityCapabilities?: Record<string, unknown> }).activityCapabilities ?? {},
  ).length
  console.info('[TEST] a consumed accepted-entry token must not mint another capability on replay')
  const replayResponse = createResponse()
  await registerHandler?.({
    params: { sessionId: session.id },
    body: { name: 'Grace Hopper', studentId: 'student2' },
    cookies: {
      ...staleCapabilityCookies,
      [getSessionParticipantCookieName(session.id)]: acceptedToken,
    },
  }, replayResponse)
  assert.equal(replayResponse.statusCode, 403)
  assert.equal(Object.keys(
    ((await sessions.get(session.id))?.data as { activityCapabilities?: Record<string, unknown> }).activityCapabilities ?? {},
  ).length, capabilityCountAfterRegistration)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const stateResponse = createResponse()
  await stateHandler?.({
    params: { sessionId: session.id },
    query: { studentId: 'student2' },
    cookies: { [response.cookies[0]!.name]: response.cookies[0]!.value },
  }, stateResponse)
  assert.equal(stateResponse.statusCode, 200)
  await sessions.close()
})

void test('a failed accepted-participant registration write leaves its handoff usable for retry', async () => {
  initializePersistentStorage(null)
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  assert.ok(acceptEntryParticipant(session, { participantId: 'student2', displayName: 'Grace Hopper' }))
  const acceptedToken = issueAcceptedEntryParticipantToken(session, 'student2')
  assert.ok(acceptedToken)
  await sessions.set(session.id, session)

  let failNextWrite = true
  const failingSessions: SessionStore = new Proxy(sessions, {
    get(target, property) {
      if (property === 'set') {
        return async (...args: Parameters<SessionStore['set']>) => {
          if (failNextWrite) {
            failNextWrite = false
            throw new Error('simulated session-store write failure')
          }
          await target.set(...args)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  setupResonanceRoutes(app, failingSessions, createMockWs())

  const registerHandler = app.handlers.post['/api/resonance/:sessionId/register-student']
  const request = {
    params: { sessionId: session.id },
    body: { name: 'Grace Hopper', studentId: 'student2' },
    cookies: { [getSessionParticipantCookieName(session.id)]: acceptedToken },
  }
  console.info('[TEST] a failed registration write must not consume the accepted-participant handoff in cache')
  const failedResponse = createResponse()
  await registerHandler?.(request, failedResponse)
  assert.equal(failedResponse.statusCode, 503)
  assert.equal(failedResponse.cookies.length, 0)

  const retryResponse = createResponse()
  await registerHandler?.(request, retryResponse)
  assert.equal(retryResponse.statusCode, 200)
  assert.equal(retryResponse.cookies.length, 1)
  await sessions.close()
})

void test('accepted participant capability replacement fails clearly when the capability store is full', async () => {
  initializePersistentStorage(null)
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  const staleCapabilityCookies = issueStudentCookies(session, 'student1')
  assert.ok(acceptEntryParticipant(session, { participantId: 'student2', displayName: 'Grace Hopper' }))
  const acceptedToken = issueAcceptedEntryParticipantToken(session, 'student2')
  assert.ok(acceptedToken)
  const capabilityCount = Object.keys((session.data as { activityCapabilities?: Record<string, unknown> }).activityCapabilities ?? {}).length
  for (let index = capabilityCount; index < 200; index += 1) {
    issueActivityCapability(session, 'participant', `capacity-student-${index}`)
  }
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())

  console.info('[TEST] a stale capability must not silently authenticate a fresh accepted participant when replacement capacity is exhausted')
  const response = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/register-student']?.({
    params: { sessionId: session.id },
    body: { name: 'Grace Hopper', studentId: 'student2' },
    cookies: { ...staleCapabilityCookies, [getSessionParticipantCookieName(session.id)]: acceptedToken },
  }, response)
  assert.equal(response.statusCode, 429)
  assert.equal(response.cookies.length, 0)
  await sessions.close()
})

void test('instructor progress shows a newer revisit draft as working while retaining its confirmed response', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  const data = session.data as unknown as { activeQuestionRunRevision?: number; responses: Array<{ activeQuestionRunRevision?: number; editSequence?: number }>; responseDrafts: Record<string, { activeQuestionRunRevision?: number; editSequence?: number; [key: string]: unknown }> }
  data.activeQuestionRunRevision = 3
  data.responses[0]!.activeQuestionRunRevision = 3
  data.responses[0]!.editSequence = 1
  data.responseDrafts['q1:student1'] = { activeQuestionRunRevision: 3, editSequence: 2, updatedAt: 9_999, questionId: 'q1', studentId: 'student1', answer: { type: 'free-response', text: 'Revised but not submitted yet.' } }
  data.responseDrafts['q1:student2'] = { activeQuestionRunRevision: 2, editSequence: 1, updatedAt: 9_998, questionId: 'q1', studentId: 'student2', answer: { type: 'free-response', text: 'Stale prior-run draft.' } }
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())
  const responseHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  const response = createResponse()
  await responseHandler?.({ params: { sessionId: session.id }, headers: { 'x-instructor-passcode': 'TEACH123' } }, response)
  assert.equal(response.statusCode, 200)
  const progress = (response.body as { progress: Array<{ studentId: string; status: string; answer: unknown; responseId: string | null }> }).progress
  const revisedProgress = progress.find((entry) => entry.studentId === 'student1')
  assert.equal(revisedProgress?.status, 'working')
  assert.deepEqual(revisedProgress?.answer, { type: 'free-response', text: 'Revised but not submitted yet.' })
  assert.equal(revisedProgress?.responseId, null)
  const staleProgress = progress.find((entry) => entry.studentId === 'student2')
  assert.equal(staleProgress?.status, 'idle')
  assert.equal(staleProgress?.answer, null)
  await sessions.close()
})

void test('student WebSocket identity is derived from its participant capability', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)
  const handler = captured.getHandler()
  assert.ok(handler)

  const cookieHeader = Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; ')
  const sentMessages: Array<{ type?: string }> = []
  const closeCalls: Array<{ code?: number; reason?: string }> = []
  const socket = {
    readyState: 1,
    upgradeHeaders: { cookie: cookieHeader },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string })
    },
    on() {},
    once() {},
    close(code?: number, reason?: string) {
      closeCalls.push({ code, reason })
    },
    terminate() {},
    ping() {},
  }
  handler(socket, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => sentMessages.some((message) => message.type === 'resonance:session-state'))
  assert.deepEqual(closeCalls, [])
  assert.equal((socket as { studentId?: string }).studentId, 'student1')

  const mismatchedCloseCalls: Array<{ code?: number; reason?: string }> = []
  const mismatchedSocket = {
    ...socket,
    send() {},
    close(code?: number, reason?: string) {
      mismatchedCloseCalls.push({ code, reason })
    },
  }
  console.info('[TEST] a WebSocket capability must not authorize a different student id')
  handler(mismatchedSocket, new URLSearchParams({
    sessionId: session.id,
    role: 'student',
    studentId: 'student2',
  }), captured.ws.wss)
  await waitForCondition(() => mismatchedCloseCalls.length > 0)
  assert.deepEqual(mismatchedCloseCalls, [{ code: 1008, reason: 'participant authentication required' }])

  await sessions.close()
})

void test('self-paced students can persist drafts and submit without an active run token', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.selfPacedMode = true
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'draft-1',
      activeQuestionRunRevision: null,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Self-paced draft' },
    },
  }))
  await waitForCondition(async () => {
    const stored = await sessions.get(session.id)
    const storedData = stored?.data as { responseDrafts?: Record<string, unknown> } | undefined
    return storedData?.responseDrafts?.['q1:student1'] !== undefined
  })
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'draft-1'
  ))

  const submitRes = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
    params: { sessionId: session.id },
    cookies: studentCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunRevision: null,
      answer: { type: 'free-response', text: 'Self-paced answer' },
    },
  }, submitRes)

  assert.equal(submitRes.statusCode, 200)
  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    responses?: Array<{ answer?: unknown }>
    responseDrafts?: Record<string, unknown>
  } | undefined
  assert.deepEqual(storedData?.responses?.[0]?.answer, {
    type: 'free-response',
    text: 'Self-paced answer',
  })
  assert.equal(storedData?.responseDrafts?.['q1:student1'], undefined)

  await sessions.close()
})

void test('the submit-answer route rejects a malformed activeQuestionRunRevision instead of silently matching a self-paced session', async () => {
  // CodeRabbit review of PR #381: matchesActiveQuestionRun used to normalize
  // *any* non-number client value (omitted, a string, NaN, a negative
  // number) down to `null` before comparing it against the session's run
  // identity. That's fine when the session has a real active run (nothing
  // normalizes to a positive integer by accident), but when the session is
  // self-paced/idle (activeQuestionRunRevision === null), a malformed value
  // would silently normalize to `null` too and incorrectly "match" — letting
  // a corrupted or buggy payload through as if it had explicitly, correctly
  // asserted "no active run". The real client always sends either an
  // explicit `null` or a genuine positive revision number, never omits the
  // field or sends a non-number, so requiring exactly that costs nothing.
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.selfPacedMode = true
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  setupResonanceRoutes(app, sessions, createMockWs())

  for (const malformedRevision of [undefined, 'not-a-number', Number.NaN, -1, 1.5]) {
    console.info(`[TEST] activeQuestionRunRevision ${JSON.stringify(malformedRevision)} must be rejected, not treated as self-paced null`)
    const res = createResponse()
    await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q1',
        ...(malformedRevision === undefined ? {} : { activeQuestionRunRevision: malformedRevision }),
        answer: { type: 'free-response', text: `Should not be stored (${String(malformedRevision)})` },
      },
    }, res)
    assert.equal(res.statusCode, 409, `expected a malformed activeQuestionRunRevision of ${JSON.stringify(malformedRevision)} to be rejected`)
  }

  console.info('[TEST] an explicit null activeQuestionRunRevision is still accepted for a genuinely self-paced session')
  const acceptedRes = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
    params: { sessionId: session.id },
    cookies: studentCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunRevision: null,
      answer: { type: 'free-response', text: 'Genuinely self-paced answer' },
    },
  }, acceptedRes)
  assert.equal(acceptedRes.statusCode, 200)

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as { responses?: Array<{ answer?: { text?: string } }> } | undefined
  assert.deepEqual(
    storedData?.responses?.map((response) => response.answer?.text),
    ['Genuinely self-paced answer'],
    'expected only the explicitly-null submission to have been stored',
  )

  await sessions.close()
})

void test('a self-paced draft that arrives after its submission is dropped, not resurrected by a lost null run revision', async () => {
  // Self-paced responses are stored with activeQuestionRunRevision explicitly
  // null (there's no live run). Every session read re-normalizes stored data
  // (normalizeStoredResponses), which used to coerce that null to undefined —
  // so the very next read after a submission broke the stale-draft guard's
  // `response.activeQuestionRunRevision === session.data.activeQuestionRunRevision`
  // comparison (undefined !== null) and let a late pre-submission draft
  // resurrect an already-submitted self-paced answer.
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.selfPacedMode = true
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  // A self-paced session read (e.g. the WS connection handshake above)
  // re-normalizes stored data at least once before the submission below, just
  // like it would on any subsequent request in production.
  const submitRes = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
    params: { sessionId: session.id },
    cookies: studentCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunRevision: null,
      editSequence: 1,
      answer: { type: 'free-response', text: 'Submitted answer' },
    },
  }, submitRes)
  assert.equal(submitRes.statusCode, 200)

  console.info('[TEST] a self-paced draft delivered after its own submission must not resurrect a stale answer')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'late-self-paced-draft',
      activeQuestionRunRevision: null,
      editSequence: 1,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Stale pre-submission draft' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'late-self-paced-draft'
  ))

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    responses?: Array<{ answer?: unknown }>
    responseDrafts?: Record<string, unknown>
  } | undefined
  assert.equal(Object.keys(storedData?.responseDrafts ?? {}).length, 0)
  assert.deepEqual(storedData?.responses?.[0]?.answer, {
    type: 'free-response',
    text: 'Submitted answer',
  })

  await sessions.close()
})

void test('a draft that arrives after its submission is dropped instead of resurrecting a stale answer', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const runStartedAt = Date.now() - 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = runStartedAt
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  // The manual REST submission completes first...
  const submitRes = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
    params: { sessionId: session.id },
    cookies: studentCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      answer: { type: 'free-response', text: 'Submitted answer' },
    },
  }, submitRes)
  assert.equal(submitRes.statusCode, 200)

  // ...but a draft queued before the submission — same editSequence, since it
  // was written during the same edit session — was still in flight over the
  // WebSocket and only reaches the server afterward.
  console.info('[TEST] a draft delivered after its own submission must not resurrect a stale answer')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'late-draft',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Stale pre-submission draft' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'late-draft'
  ))

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    responses?: Array<{ answer?: unknown }>
    responseDrafts?: Record<string, unknown>
  } | undefined
  assert.equal(Object.keys(storedData?.responseDrafts ?? {}).length, 0)
  assert.deepEqual(storedData?.responses?.[0]?.answer, {
    type: 'free-response',
    text: 'Submitted answer',
  })

  await sessions.close()
})

void test('a draft made after revisiting an already-submitted question in the same run is persisted, not dropped as stale', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const runStartedAt = Date.now() - 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = runStartedAt
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  // The student answers and submits once (editSequence 1)...
  const submitRes = createResponse()
  await app.handlers.post['/api/resonance/:sessionId/submit-answer']?.({
    params: { sessionId: session.id },
    cookies: studentCookies,
    body: {
      studentId: 'student1',
      questionId: 'q1',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      answer: { type: 'free-response', text: 'First answer' },
    },
  }, submitRes)
  assert.equal(submitRes.statusCode, 200)

  // ...then clicks the tab to revisit the same (still-active, same-run)
  // question — the client bumps its local edit sequence for this new editing
  // session — and starts typing a revision without resubmitting yet.
  console.info('[TEST] a post-submission revisit draft in the same run must be persisted, not treated as stale')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'revisit-draft',
      activeQuestionRunRevision: 1,
      editSequence: 2,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Revised answer, not yet resubmitted' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'revisit-draft'
  ))

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    responses?: Array<{ answer?: unknown }>
    responseDrafts?: Record<string, {
      questionId?: string
      studentId?: string
      activeQuestionRunRevision?: number | null
      editSequence?: number
      draftSendSequence?: number
      answer?: unknown
    }>
  } | undefined
  const revisitDraft = storedData?.responseDrafts?.['q1:student1']
  assert.ok(revisitDraft)
  assert.deepEqual(
    { ...revisitDraft, updatedAt: undefined },
    {
      questionId: 'q1',
      studentId: 'student1',
      draftSendSequence: 1,
      updatedAt: undefined,
      activeQuestionRunRevision: 1,
      editSequence: 2,
      answer: { type: 'free-response', text: 'Revised answer, not yet resubmitted' },
    },
  )
  // The confirmed response is untouched until the student resubmits or the
  // deadline finalizes the pending draft.
  assert.deepEqual(storedData?.responses?.[0]?.answer, {
    type: 'free-response',
    text: 'First answer',
  })

  await sessions.close()
})

void test('an older draft write cannot clobber a newer one for the same question that already landed first', async () => {
  // Regression test (Copilot review of PR #381): each resonance:update-draft
  // message is handled by its own async function starting from a fresh
  // session read, so two overlapping sends for the same question (e.g. a
  // client-side retry racing its own still-outstanding original attempt) can
  // finish processing out of the order they were sent in. Without a guard
  // here, a slower older write landing after a faster newer one would
  // silently clobber it — this reproduces that by sending the "newer" write
  // first and the "older" one second, which is exactly what an out-of-order
  // completion looks like from the server's point of view.
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const runStartedAt = Date.now() - 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = runStartedAt
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  type StoredData = {
    responseDrafts?: Record<string, {
      questionId?: string
      studentId?: string
      activeQuestionRunRevision?: number | null
      editSequence?: number
      draftSendSequence?: number
      updatedAt?: number
      answer?: unknown
    }>
  }

  // The student revisits (editSequence bumps to 2) and this newer write
  // reaches and is processed by the server first.
  console.info('[TEST] the newer (revisit) draft write lands first')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'newer-draft',
      activeQuestionRunRevision: 1,
      editSequence: 2,
      draftSendSequence: 2,
      answer: { type: 'free-response', text: 'Newer, revisited answer' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'newer-draft'
  ))

  // A straggling write from before the revisit (still editSequence 1, sent
  // over the same connection but delayed in server-side processing) now
  // arrives and is processed second.
  console.info('[TEST] a straggling older (pre-revisit) draft write lands second, after the newer one')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'older-straggler',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Stale pre-revisit answer' },
    },
  }))
  // This straggler's content differs from what's stored, so it must not be
  // acknowledged as saved (see the "second concurrent tab" test below);
  // wait for a settled tick instead of an ack that will never come.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(
    !sentMessages.some((message) => message.payload?.draftId === 'older-straggler'),
    'a rejected write whose content differs from what’s stored must not be acknowledged as saved',
  )

  const storedAfterStraggler = (await sessions.get(session.id))?.data as StoredData | undefined
  const draftAfterStraggler = storedAfterStraggler?.responseDrafts?.['q1:student1']
  assert.equal(
    draftAfterStraggler?.editSequence,
    2,
    'the older straggler must not have overwritten the newer draft’s editSequence',
  )
  assert.deepEqual(
    draftAfterStraggler?.answer,
    { type: 'free-response', text: 'Newer, revisited answer' },
    'the older straggler must not have overwritten the newer draft’s content',
  )

  // Same-editSequence tiebreaker: seed a draft with a high draftSendSequence
  // (simulating "this slot was already written by a later client send"),
  // then send a same-editSequence write carrying a *lower* draftSendSequence
  // — it must be rejected, even though it's processed later in wall-clock
  // time. draftSendSequence (client-assigned at send time), not the
  // handler's own resumption timestamp, is what orders same-editSequence
  // writes — see the ordering guard's comment for why the timestamp was
  // rejected as unsound (it reflects server resumption order, not client
  // send order, and those can differ under overlapping sends).
  const sessionBeforeTiebreakerCheck = await sessions.get(session.id)
  assert.ok(sessionBeforeTiebreakerCheck)
  ;(sessionBeforeTiebreakerCheck!.data as StoredData).responseDrafts!['q1:student1'] = {
    questionId: 'q1',
    studentId: 'student1',
    activeQuestionRunRevision: 1,
    editSequence: 2,
    draftSendSequence: 100,
    updatedAt: Date.now(),
    answer: { type: 'free-response', text: 'Sent later by the client, written first' },
  }
  await sessions.set(session.id, sessionBeforeTiebreakerCheck!)

  console.info('[TEST] a same-editSequence write with a lower draftSendSequence is rejected, not merged in')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'same-sequence-straggler',
      activeQuestionRunRevision: 1,
      editSequence: 2,
      draftSendSequence: 99,
      answer: { type: 'free-response', text: 'Sent earlier by the client, written second' },
    },
  }))
  // This straggler's content differs from what's stored, so — unlike a
  // same-content retry — it must not be acknowledged as saved (see the
  // "second concurrent tab" test below for why); wait for a settled tick
  // instead of an ack that will never come.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const storedAfterTiebreaker = (await sessions.get(session.id))?.data as StoredData | undefined
  const draftAfterTiebreaker = storedAfterTiebreaker?.responseDrafts?.['q1:student1']
  assert.equal(draftAfterTiebreaker?.draftSendSequence, 100)
  assert.deepEqual(
    draftAfterTiebreaker?.answer,
    { type: 'free-response', text: 'Sent later by the client, written first' },
    'a same-editSequence write with a lower draftSendSequence must not overwrite what’s stored',
  )
  assert.ok(
    !sentMessages.some((message) => message.payload?.draftId === 'same-sequence-straggler'),
    'a rejected write whose content differs from what’s stored must not be acknowledged as saved',
  )

  console.info('[TEST] a same-editSequence write with a lower draftSendSequence but identical content is still acknowledged')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'same-sequence-same-content-straggler',
      activeQuestionRunRevision: 1,
      editSequence: 2,
      draftSendSequence: 99,
      answer: { type: 'free-response', text: 'Sent later by the client, written first' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'same-sequence-same-content-straggler'
  ))

  await sessions.close()
})

void test('a stale draft write from a second concurrent tab is not acknowledged as saved when its content was actually discarded', async () => {
  // Copilot review of PR #381: draftSendSequence is a per-mount counter
  // (nextDraftSendSequenceRef in ResonanceStudent.tsx starts at 0 on every
  // mount), so it only totally orders sends from a *single* ResonanceStudent
  // instance. It carries no meaning across two concurrent mounts for the
  // same student — e.g. the same student's capability open in two browser
  // tabs. If tab A has sent several drafts (its counter is now high) and tab
  // B, a fresh mount, sends its own first edit (draftSendSequence 1), tab
  // B's genuinely different, more-recent-from-its-own-perspective content
  // loses the isStaleDraftWrite tiebreaker purely because its local counter
  // is smaller — not because it's actually older. The guard was previously
  // acking every rejected write unconditionally ("so a superseded retry
  // doesn't get reported as a failed save"), which is only true when the
  // rejected write's content is subsumed by what's already stored (the
  // single-tab retry case this guard was built for). Acking tab B's write
  // here would tell it the edit was persisted — it isn't — and tab B's own
  // unconfirmed-draft tracking would stop retrying it, silently losing the
  // student's actual latest edit.
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = Date.now() - 1_000
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  type StoredData = {
    responseDrafts?: Record<string, {
      draftSendSequence?: number
      answer?: unknown
    }>
  }

  console.info('[TEST] tab A has already sent several drafts, ratcheting its send counter up')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'tab-a-draft',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 10,
      answer: { type: 'free-response', text: 'Tab A content' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'tab-a-draft'
  ))

  console.info('[TEST] tab B, a fresh mount, sends its own genuinely different first edit')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'tab-b-draft',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Tab B content' },
    },
  }))
  // No ack should ever arrive for tab B's rejected, actually-discarded write.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const storedAfterTabB = (await sessions.get(session.id))?.data as StoredData | undefined
  const draftAfterTabB = storedAfterTabB?.responseDrafts?.['q1:student1']
  assert.deepEqual(
    draftAfterTabB?.answer,
    { type: 'free-response', text: 'Tab A content' },
    'tab B’s write must not have overwritten tab A’s already-stored content',
  )
  assert.ok(
    !sentMessages.some((message) => message.payload?.draftId === 'tab-b-draft'),
    'tab B’s discarded write must not be acknowledged as saved',
  )

  console.info('[TEST] tab B’s own retry loop resends its current value with a fresh, higher send sequence')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'tab-b-retry',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 11,
      answer: { type: 'free-response', text: 'Tab B content' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'tab-b-retry'
  ))

  const storedAfterRetry = (await sessions.get(session.id))?.data as StoredData | undefined
  assert.deepEqual(
    storedAfterRetry?.responseDrafts?.['q1:student1']?.answer,
    { type: 'free-response', text: 'Tab B content' },
    'a genuine retry with a higher send sequence eventually lands, so the edit is never permanently lost',
  )

  await sessions.close()
})

void test('an update-draft write with a missing or invalid draftSendSequence is dropped, not silently coerced to zero', async () => {
  // CodeRabbit review of PR #381: resolveEditSequence's zero-fallback exists
  // to normalize historical *stored* drafts, not to validate a live write —
  // silently coercing a missing/malformed draftSendSequence to 0 would let a
  // malformed payload masquerade as a legitimate "first send" and jump the
  // same-editSequence tiebreaker ahead of a write that's genuinely first. A
  // real client always sends a positive integer (it pre-increments before
  // every send), so the handler now requires one and drops anything else.
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = Date.now() - 1_000
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  const invalidPayloads: Array<{ label: string; draftSendSequence?: unknown }> = [
    { label: 'missing' },
    { label: 'string', draftSendSequence: 'not-a-number' },
    { label: 'zero', draftSendSequence: 0 },
    { label: 'negative', draftSendSequence: -1 },
    { label: 'non-integer', draftSendSequence: 1.5 },
  ]
  for (const { label, draftSendSequence } of invalidPayloads) {
    console.info(`[TEST] a draft write with a ${label} draftSendSequence must be dropped`)
    messageHandlers[0]?.(JSON.stringify({
      type: 'resonance:update-draft',
      payload: {
        studentId: 'student1',
        questionId: 'q1',
        draftId: `invalid-${label}`,
        activeQuestionRunRevision: 1,
        editSequence: 1,
        ...(draftSendSequence === undefined ? {} : { draftSendSequence }),
        answer: { type: 'free-response', text: 'Should not be stored' },
      },
    }))
  }

  console.info('[TEST] a draft write with a valid draftSendSequence is accepted afterward')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'valid-draft',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      draftSendSequence: 1,
      answer: { type: 'free-response', text: 'Should be stored' },
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'valid-draft'
  ))

  assert.deepEqual(
    sentMessages
      .filter((message) => message.type === 'resonance:draft-saved')
      .map((message) => message.payload?.draftId),
    ['valid-draft'],
    `expected only the valid write to be acknowledged, got: ${JSON.stringify(sentMessages)}`,
  )

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as { responseDrafts?: Record<string, { answer?: { text?: string } }> } | undefined
  assert.equal(storedData?.responseDrafts?.['q1:student1']?.answer?.text, 'Should be stored')

  await sessions.close()
})

void test('clearing a draft over the websocket still acknowledges the write, present or absent', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = Date.now() - 1_000
  session.data.activeQuestionRunRevision = 1
  session.data.lastActiveQuestionRunRevision = 1
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: Date.now() - 500,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'Draft to be cleared' },
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)
  const captured = createCapturingMockWs()
  setupResonanceRoutes(app, sessions, captured.ws)

  const handler = captured.getHandler()
  const messageHandlers: Array<(message: string) => void> = []
  const sentMessages: Array<{ type?: string; payload?: { draftId?: string } }> = []
  assert.ok(handler)
  handler({
    readyState: 1,
    upgradeHeaders: {
      cookie: Object.entries(studentCookies).map(([name, value]) => `${name}=${value}`).join('; '),
    },
    send(message: string) {
      sentMessages.push(JSON.parse(message) as { type?: string; payload?: { draftId?: string } })
    },
    on(event: string, callback: (message: string) => void) {
      if (event === 'message') messageHandlers.push(callback)
    },
    once() {},
    close() {},
    terminate() {},
    ping() {},
  }, new URLSearchParams({ sessionId: session.id, role: 'student', studentId: 'student1' }), captured.ws.wss)
  await waitForCondition(() => messageHandlers.length === 1)

  console.info('[TEST] clearing an existing draft must still send resonance:draft-saved')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'clear-existing',
      activeQuestionRunRevision: 1,
      draftSendSequence: 1,
      answer: null,
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'clear-existing'
  ))
  const storedAfterClear = await sessions.get(session.id)
  const storedAfterClearData = storedAfterClear?.data as { responseDrafts?: Record<string, unknown> } | undefined
  assert.equal(storedAfterClearData?.responseDrafts?.['q1:student1'], undefined)

  console.info('[TEST] clearing an already-absent draft (a retried clear) must still send resonance:draft-saved')
  messageHandlers[0]?.(JSON.stringify({
    type: 'resonance:update-draft',
    payload: {
      studentId: 'student1',
      questionId: 'q1',
      draftId: 'clear-already-absent',
      activeQuestionRunRevision: 1,
      draftSendSequence: 1,
      answer: null,
    },
  }))
  await waitForCondition(() => sentMessages.some((message) =>
    message.type === 'resonance:draft-saved' && message.payload?.draftId === 'clear-already-absent'
  ))

  await sessions.close()
})

void test('server deadline task finalizes and broadcasts drafts without post-deadline client activity', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  let now = 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = 800
  session.data.activeQuestionRunRevision = 1
  session.data.activeQuestionDeadlineAt = 1_100
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: 1_050,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'Saved before time ran out' },
    },
  }
  await sessions.set(session.id, session)

  const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  const ws = createMockWs()
  const messages: Array<{ type?: string }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      messages.push(JSON.parse(message) as { type?: string })
    },
  })
  setupResonanceRoutes(app, sessions, ws, {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = { callback, delayMs, cancelled: false, unref() {} }
      scheduled.push(handle)
      return handle
    },
    cancel(handle) {
      ;(handle as { cancelled: boolean }).cancelled = true
    },
  })

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  await stateHandler?.({ params: { sessionId: session.id } }, createResponse())
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0]?.delayMs, 100)

  now = 1_100
  scheduled[0]?.callback()
  await waitForCondition(async () => {
    const stored = await sessions.get(session.id)
    return Array.isArray(stored?.data.responses) && stored.data.responses.length === 1
  })
  const stored = await sessions.get(session.id)
  assert.deepEqual(stored?.data.activeQuestionIds, [])
  assert.deepEqual(stored?.data.responseDrafts, {})
  assert.equal(messages.some((message) => message.type === 'resonance:instructor-state'), true)

  await sessions.close()
})

void test('server deadline task segments delays above the Node timer maximum', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  let now = 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = now
  session.data.activeQuestionDeadlineAt = now + 2_147_483_647 + 500
  await sessions.set(session.id, session)

  const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  setupResonanceRoutes(app, sessions, createMockWs(), {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = { callback, delayMs, cancelled: false, unref() {} }
      scheduled.push(handle)
      return handle
    },
    cancel(handle) {
      ;(handle as { cancelled: boolean }).cancelled = true
    },
  })

  await app.handlers.get['/api/resonance/:sessionId/state']?.(
    { params: { sessionId: session.id } },
    createResponse(),
  )
  assert.equal(scheduled[0]?.delayMs, 2_147_483_647)

  now += 2_147_483_647
  scheduled[0]?.callback()
  assert.equal(scheduled[1]?.delayMs, 500)

  await sessions.close()
})

void test('server deadline task retries after a strict session read failure', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  let now = 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = 800
  session.data.activeQuestionRunRevision = 1
  session.data.activeQuestionDeadlineAt = 1_100
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: 1_050,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'Retry this persisted draft' },
    },
  }
  await sessions.set(session.id, session)

  let strictReads = 0
  sessions.getStrict = async (sessionId) => {
    strictReads += 1
    if (strictReads === 1) throw new Error('simulated Valkey read failure')
    return sessions.get(sessionId)
  }
  const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  setupResonanceRoutes(app, sessions, createMockWs(), {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = { callback, delayMs, cancelled: false, unref() {} }
      scheduled.push(handle)
      return handle
    },
    cancel(handle) {
      ;(handle as { cancelled: boolean }).cancelled = true
    },
  })

  await app.handlers.get['/api/resonance/:sessionId/state']?.(
    { params: { sessionId: session.id } },
    createResponse(),
  )
  now = 1_100
  console.info('[TEST] a transient strict deadline read failure is expected and must re-arm the task')
  scheduled[0]?.callback()
  await waitForCondition(() => scheduled.length === 2)
  assert.equal(scheduled[1]?.delayMs, 1_000)
  assert.deepEqual((await sessions.get(session.id))?.data.responses, [])

  now = 2_100
  scheduled[1]?.callback()
  await waitForCondition(async () => {
    const stored = await sessions.get(session.id)
    return Array.isArray(stored?.data.responses) && stored.data.responses.length === 1
  })
  assert.equal(strictReads, 2)

  await sessions.close()
})

void test('server deadline task retries after a finalization write failure without mutating its cached session', async () => {
  const app = createMockApp()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  let now = 1_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = 800
  session.data.activeQuestionRunRevision = 1
  session.data.activeQuestionDeadlineAt = 1_100
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: 1_050,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'Persist me after retry' },
    },
  }
  await sessions.set(session.id, session)

  const originalSet = sessions.set.bind(sessions)
  let failNextWrite = true
  sessions.set = async (...args) => {
    if (failNextWrite) {
      failNextWrite = false
      throw new Error('simulated deadline finalization write failure')
    }
    await originalSet(...args)
  }
  const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  setupResonanceRoutes(app, sessions, createMockWs(), {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = { callback, delayMs, cancelled: false, unref() {} }
      scheduled.push(handle)
      return handle
    },
    cancel(handle) {
      ;(handle as { cancelled: boolean }).cancelled = true
    },
  })

  await app.handlers.get['/api/resonance/:sessionId/state']?.(
    { params: { sessionId: session.id } },
    createResponse(),
  )
  now = 1_100
  console.info('[TEST] a failed deadline finalization write is expected and must leave the retry armed')
  scheduled[0]?.callback()
  await waitForCondition(() => scheduled.length === 2)
  assert.equal(scheduled[1]?.delayMs, 1_000)
  const afterFailedWrite = await sessions.get(session.id)
  assert.deepEqual(afterFailedWrite?.data.activeQuestionIds, ['q1'])
  assert.equal(Array.isArray(afterFailedWrite?.data.responses) && afterFailedWrite.data.responses.length, 0)

  now = 2_100
  scheduled[1]?.callback()
  await waitForCondition(async () => {
    const stored = await sessions.get(session.id)
    return Array.isArray(stored?.data.responses) && stored.data.responses.length === 1
  })
  assert.deepEqual((await sessions.get(session.id))?.data.activeQuestionIds, [])

  await sessions.close()
})

void test('timed live runs finalize persisted drafts for every active question', async () => {
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const now = Date.now()
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1', 'q2']
  session.data.activeQuestionRunStartedAt = now - 10_000
  session.data.activeQuestionRunRevision = 1
  session.data.activeQuestionDeadlineAt = now - 1_000
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: now - 2_000,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'First persisted draft' },
    },
    'q2:student1': {
      questionId: 'q2',
      studentId: 'student1',
      updatedAt: now - 2_000,
      activeQuestionRunRevision: 1,
      answer: { type: 'multiple-choice', selectedOptionIds: ['q2_b'] },
    },
  }
  await sessions.set(session.id, session)

  const app = createMockApp()
  const ws = createMockWs()
  const studentMessages: Array<{ type?: string }> = []
  const instructorMessages: Array<{ type?: string }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: false,
    studentId: 'student1',
    send(message: string) {
      studentMessages.push(JSON.parse(message) as { type?: string })
    },
  })
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string })
    },
  })
  setupResonanceRoutes(app, sessions, ws)
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const stateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, stateRes)

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    activeQuestionIds: string[]
    responseDrafts: Record<string, unknown>
    responses: Array<{ questionId: string; answer: unknown }>
  } | undefined
  assert.equal(stateRes.statusCode, 200)
  assert.ok(studentMessages.some((message) => message.type === 'resonance:session-state'))
  assert.ok(instructorMessages.some((message) => message.type === 'resonance:instructor-state'))
  assert.deepEqual(storedData?.activeQuestionIds, [])
  assert.equal(Object.keys(storedData?.responseDrafts ?? {}).length, 0)
  assert.deepEqual(
    storedData?.responses.map((response) => ({ questionId: response.questionId, answer: response.answer })),
    [
      { questionId: 'q1', answer: { type: 'free-response', text: 'First persisted draft' } },
      { questionId: 'q2', answer: { type: 'multiple-choice', selectedOptionIds: ['q2_b'] } },
    ],
  )

  await sessions.close()
})

void test('timed live runs discard a prior-revision draft with the same activation timestamp', async () => {
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const sharedTimestamp = Date.now() - 2_000
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1']
  session.data.activeQuestionRunStartedAt = sharedTimestamp
  session.data.activeQuestionRunRevision = 2
  session.data.lastActiveQuestionRunRevision = 2
  session.data.activeQuestionDeadlineAt = Date.now() - 1_000
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: sharedTimestamp,
      activeQuestionRunRevision: 1,
      answer: { type: 'free-response', text: 'Draft from prior run' },
    },
  }
  await sessions.set(session.id, session)

  const app = createMockApp()
  setupResonanceRoutes(app, sessions, createMockWs())
  await app.handlers.get['/api/resonance/:sessionId/state']?.(
    { params: { sessionId: session.id } },
    createResponse(),
  )

  const stored = await sessions.get(session.id)
  assert.deepEqual(stored?.data.responses, [])
  assert.deepEqual(stored?.data.responseDrafts, {})

  await sessions.close()
})

void test('embedded resonance sessions auto-activate all questions when embedded launch requests it', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    activeQuestionIds?: string[]
    embeddedAutoActivatedAt?: number | null
    embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
  } | undefined

  assert.deepEqual(storedData?.activeQuestionIds, ['q1', 'q2'])
  assert.equal(typeof storedData?.embeddedAutoActivatedAt, 'number')
  assert.deepEqual(storedData?.embeddedLaunch?.selectedOptions, {
    questions: [
      {
        id: 'q1',
        type: 'free-response',
        text: 'What is one thing you are still uncertain about?',
        order: 0,
      },
      {
        id: 'q2',
        type: 'multiple-choice',
        text: 'Which answer is correct?',
        order: 1,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
  })

  await sessions.close()
})

void test('staged embedded auto-activation stamps stem-only MCQ run start without starting timer', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      presentationMode: 'staged',
      questions: [
        {
          id: 'q1',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 0,
          responseTimeLimitMs: 30_000,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const stagedRun = stored?.data.stagedRun as { currentQuestionId?: string | null; choicesRevealed?: boolean } | null | undefined
  assert.deepEqual(stored?.data.activeQuestionIds, ['q1'])
  assert.equal(typeof stored?.data.activeQuestionRunStartedAt, 'number')
  assert.equal(stored?.data.activeQuestionDeadlineAt, null)
  assert.equal(stagedRun?.currentQuestionId, 'q1')
  assert.equal(stagedRun?.choicesRevealed, false)

  await sessions.close()
})

void test('embedded resonance sessions do not re-auto-activate after instructors clear questions', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const initiallyStored = await sessions.get(session.id)
  const initiallyStoredData = initiallyStored?.data as {
    embeddedAutoActivatedAt?: number | null
  } | undefined
  assert.equal(typeof initiallyStoredData?.embeddedAutoActivatedAt, 'number')

  const clearedSession = await sessions.get(session.id)
  assert.ok(clearedSession)
  const clearedSessionData = clearedSession.data as Record<string, unknown>
  clearedSessionData.activeQuestionId = null
  clearedSessionData.activeQuestionIds = []
  clearedSessionData.activeQuestionRunStartedAt = null
  clearedSessionData.activeQuestionDeadlineAt = null
  clearedSessionData.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }
  await sessions.set(clearedSession.id, clearedSession)

  const afterClearStored = await sessions.get(session.id)
  const afterClearStoredData = afterClearStored?.data as {
    activeQuestionIds?: string[]
    activeQuestionRunStartedAt?: number | null
    activeQuestionDeadlineAt?: number | null
    embeddedAutoActivatedAt?: number | null
    embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
  } | undefined

  assert.deepEqual(afterClearStoredData?.activeQuestionIds, [])
  assert.equal(afterClearStoredData?.activeQuestionRunStartedAt, null)
  assert.equal(afterClearStoredData?.activeQuestionDeadlineAt, null)
  assert.equal(typeof afterClearStoredData?.embeddedAutoActivatedAt, 'number')
  assert.deepEqual(afterClearStoredData?.embeddedLaunch?.selectedOptions, {
    questions: [
      {
        id: 'q1',
        type: 'free-response',
        text: 'What is one thing you are still uncertain about?',
        order: 0,
      },
      {
        id: 'q2',
        type: 'multiple-choice',
        text: 'Which answer is correct?',
        order: 1,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
  })

  await sessions.close()
})

void test('self-paced embedded resonance sessions expose all questions to students when the parent SyncDeck session is standalone', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const childSession = createEmbeddedResonanceSession()
  childSession.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }
  await sessions.set(childSession.id, childSession)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: childSession.id },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
  }
  assert.equal(body.selfPacedMode, true)
  assert.deepEqual(body.activeQuestionIds, ['q1', 'q2'])
  assert.deepEqual(body.activeQuestions?.map((question) => question.id), ['q1', 'q2'])

  const storedChild = await sessions.get(childSession.id)
  assert.equal(
    (storedChild?.data as { selfPacedMode?: boolean } | undefined)?.selfPacedMode,
    true,
  )

  await sessions.close()
})

void test('self-paced embedded resonance sessions reveal MCQ correctness after the student submits every question', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createMultiQuestionSession()
  session.id = 'CHILD:syncdeck-parent:solo:resonance'
  session.data.embeddedParentSessionId = 'syncdeck-parent'
  session.data.embeddedInstanceKey = 'resonance:3:0'
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 100,
      activeQuestionRunRevision: null,
      answer: {
        type: 'free-response',
        text: 'Because the condition becomes false.',
      },
    },
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      activeQuestionRunRevision: null,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
      cookies: studentCookies,
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    reveals?: Array<{
      questionId?: string
      correctOptionIds?: string[] | null
      viewerResponse?: {
        answer?: { type?: string; selectedOptionIds?: string[] }
      } | null
    }>
  }
  assert.deepEqual(body.reveals?.map((reveal) => reveal.questionId), ['q2'])
  assert.deepEqual(body.reveals?.[0]?.correctOptionIds, ['q2_a'])
  assert.deepEqual(body.reveals?.[0]?.viewerResponse?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('student state normalizes legacy reveal answers that still use selectedOptionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session = createInstructorResonanceSession()

  session.data.questions = [
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      activeQuestionRunRevision: 1,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  session.data.reveals = [
    {
      questionId: 'q2',
      sharedAt: now,
      correctOptionIds: ['q2_a'],
      sharedResponses: [
        {
          id: 'r2',
          questionId: 'q2',
          answer: {
            type: 'multiple-choice',
            selectedOptionId: 'q2_b',
          } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
          sharedAt: now,
          instructorEmoji: null,
          reactions: {},
        },
      ],
      viewerResponse: {
        answer: {
          type: 'multiple-choice',
          selectedOptionId: 'q2_b',
        } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
        submittedAt: now - 50,
        instructorEmoji: null,
        isShared: true,
      },
    },
  ]
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
      cookies: studentCookies,
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ answer?: { type?: string; selectedOptionIds?: string[] } }>
      viewerResponse?: { answer?: { type?: string; selectedOptionIds?: string[] } } | null
    }>
  }
  assert.deepEqual(body.reveals?.[0]?.sharedResponses?.[0]?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })
  assert.deepEqual(body.reveals?.[0]?.viewerResponse?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('report route tolerates legacy reveal answers that still use selectedOptionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session = createInstructorResonanceSession()

  session.data.questions = [
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  session.data.reveals = [
    {
      questionId: 'q2',
      sharedAt: now,
      correctOptionIds: ['q2_a'],
      sharedResponses: [
        {
          id: 'r2',
          questionId: 'q2',
          answer: {
            type: 'multiple-choice',
            selectedOptionId: 'q2_b',
          } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
          sharedAt: now,
          instructorEmoji: null,
          reactions: {},
        },
      ],
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const reportHandler = app.handlers.get['/api/resonance/:sessionId/report']
  assert.equal(typeof reportHandler, 'function')

  const response = createResponse()
  await reportHandler?.(
    {
      params: { sessionId: session.id },
      headers: { 'x-instructor-passcode': 'TEACH123' },
      query: { format: 'json' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    questions?: Array<{
      reveal?: {
        sharedResponses?: Array<{ answer?: { type?: string; selectedOptionIds?: string[] } }>
      } | null
    }>
  }
  assert.deepEqual(body.questions?.[0]?.reveal?.sharedResponses?.[0]?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('self-paced embedded resonance sessions still surface annotated reviewed responses when no live run is active', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createEmbeddedResonanceSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
  ]
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 200,
      activeQuestionRunRevision: null,
      answer: {
        type: 'free-response',
        text: 'My answer',
      },
    },
  ]
  session.data.students = {
    student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
  }
  session.data.annotations = {
    r1: {
      starred: false,
      flagged: false,
      emoji: '💡',
    },
  }
  session.data.reveals = []
  session.data.activeQuestionId = null
  session.data.activeQuestionIds = []
  session.data.activeQuestionDeadlineAt = null
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { text?: string }
    }>
  }
  assert.equal(body.selfPacedMode, true)
  assert.deepEqual(body.activeQuestionIds, ['q1'])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'My answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.text, 'Explain your reasoning.')

  await sessions.close()
})

void test('self-paced embedded resonance sessions switch back to live-run snapshot semantics once questions are activated', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createEmbeddedResonanceSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B' },
      ],
    },
  ]
  session.data.activeQuestionId = 'q2'
  session.data.activeQuestionIds = ['q2']
  session.data.activeQuestionRunStartedAt = now - 500
  session.data.activeQuestionDeadlineAt = now + 30_000
  session.data.students = {
    student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
  }
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 200,
      // Submitted while this was still self-paced, before the instructor
      // activated q2 as a live question below.
      activeQuestionRunRevision: null,
      answer: {
        type: 'free-response',
        text: 'Earlier answer',
      },
    },
  ]
  session.data.annotations = {
    r1: {
      starred: false,
      flagged: false,
      emoji: '💡',
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id?: string }>
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { id?: string }
    }>
  }
  assert.equal(body.selfPacedMode, false)
  assert.deepEqual(body.activeQuestionIds, ['q2'])
  assert.deepEqual(body.activeQuestions?.map((question) => question.id), ['q2'])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'Earlier answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.id, 'q1')

  await sessions.close()
})

void test('instructor-passcode route returns passcode for embedded child sessions when parent syncdeck teacher cookie matches', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const embeddedSession = createEmbeddedResonanceSession()
  await sessions.set(embeddedSession.id, embeddedSession)
  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  })

  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-parent', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.get['/api/resonance/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: embeddedSession.id },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `syncdeck:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: (await sessions.get(embeddedSession.id))?.data.instructorPasscode,
  })

  await sessions.close()
})

void test('prepare-link-options returns encrypted resonance selectedOptions without creating a persistent session', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/prepare-link-options']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: {},
      body: {
        teacherCode: 'teacher-code',
        presentationMode: 'staged',
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What stood out?',
            order: 0,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { selectedOptions?: { q?: string; h?: string; presentationMode?: string } }
  assert.equal(typeof body.selectedOptions?.q, 'string')
  assert.equal(typeof body.selectedOptions?.h, 'string')
  assert.equal(body.selectedOptions?.presentationMode, 'staged')
  assert.ok((body.selectedOptions?.q ?? '').length > 0)
  assert.equal((body.selectedOptions?.h ?? '').length, 20)

  await sessions.close()
})

void test('create supports explicit self-paced solo sessions from prepared question payloads', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const prepareHandler = app.handlers.post['/api/resonance/prepare-link-options']
  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof prepareHandler, 'function')
  assert.equal(typeof createHandler, 'function')

  const prepareRes = createResponse()
  await prepareHandler?.(
    {
      params: {},
      body: {
        teacherCode: 'teacher-code',
        questions: [
          {
            id: 'q1',
            type: 'multiple-choice',
            text: 'Pick one',
            order: 0,
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correctOptionIds: ['a'],
          },
        ],
      },
    },
    prepareRes,
  )

  const selectedOptions = (prepareRes.body as { selectedOptions?: { q?: string; h?: string } }).selectedOptions
  assert.equal(typeof selectedOptions?.q, 'string')
  assert.equal(typeof selectedOptions?.h, 'string')

  const createRes = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        encodedQuestions: selectedOptions?.q,
        persistentHash: selectedOptions?.h,
        selfPacedMode: true,
      },
    },
    createRes,
  )

  assert.equal(createRes.statusCode, 200)
  const createdBody = createRes.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(createdBody.instructorPasscode, undefined)

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
    persistentHash?: string | null
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, true)
  assert.equal(storedData?.persistentHash, selectedOptions?.h)
  assert.deepEqual(
    storedData?.questions?.map((question) => question.id),
    ['q1'],
  )

  await sessions.close()
})

void test('create rejects self-paced solo sessions when the prepared question payload is invalid', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        encodedQuestions: 'tampered-payload',
        persistentHash: 'bad-hash',
        selfPacedMode: true,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'self-paced Resonance launch requires a valid question payload',
  })

  await sessions.close()
})

void test('create supports explicit self-paced solo sessions from raw question payloads', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
        selfPacedMode: true,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(createdBody.instructorPasscode, undefined)

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
    persistentHash?: string | null
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, true)
  assert.equal(storedData?.persistentHash, null)
  assert.deepEqual(
    storedData?.questions?.map((question) => question.id),
    ['q1'],
  )

  await sessions.close()
})

void test('create ignores raw question payloads when self-paced mode is not requested', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Should be ignored without self-paced mode',
            order: 0,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(typeof createdBody.instructorPasscode, 'string')

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, undefined)
  assert.deepEqual(storedData?.questions ?? [], [])

  await sessions.close()
})

void test('self-paced sessions created from raw multi-question payloads expose the full question set to students', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof createHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const createRes = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Question one',
            order: 0,
          },
          {
            id: 'q2',
            type: 'multiple-choice',
            text: 'Question two',
            order: 1,
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          {
            id: 'q3',
            type: 'free-response',
            text: 'Question three',
            order: 2,
          },
        ],
        selfPacedMode: true,
      },
    },
    createRes,
  )

  assert.equal(createRes.statusCode, 200)
  const createdBody = createRes.body as { id?: string }
  assert.equal(typeof createdBody.id, 'string')

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: createdBody.id },
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const stateBody = stateRes.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
  }
  assert.equal(stateBody.selfPacedMode, true)
  assert.deepEqual(stateBody.activeQuestionIds, ['q1', 'q2', 'q3'])
  assert.deepEqual(stateBody.activeQuestions?.map((question) => question.id), ['q1', 'q2', 'q3'])

  await sessions.close()
})

void test('student state exposes multiple-choice selectionMode based on the authored correct options', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Pick one',
      order: 0,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B' },
      ],
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Pick all that apply',
      order: 1,
      options: [
        { id: 'c', text: 'C', isCorrect: true },
        { id: 'd', text: 'D', isCorrect: true },
        { id: 'e', text: 'E' },
      ],
    },
  ]
  session.data.activeQuestionIds = ['q1', 'q2']
  session.data.activeQuestionId = 'q1'
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    activeQuestions?: Array<{ id: string; selectionMode?: string }>
  }
  assert.deepEqual(body.activeQuestions?.map((question) => ({
    id: question.id,
    selectionMode: question.selectionMode,
  })), [
    { id: 'q1', selectionMode: 'single' },
    { id: 'q2', selectionMode: 'multiple' },
  ])

  await sessions.close()
})

void test('responses route reports the highest-ever run revision even after the active run ends', async () => {
  // The instructor client needs this watermark to order a delayed pre-timeout
  // snapshot against the finalized (revision-null) state, the same way
  // students already do — see shouldApplyInstructorSnapshot.
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  session.data.activeQuestionIds = []
  session.data.activeQuestionRunRevision = null
  session.data.lastActiveQuestionRunRevision = 3
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { activeQuestionRunRevision?: number | null; lastActiveQuestionRunRevision?: number | null }
  assert.equal(body.activeQuestionRunRevision, null)
  assert.equal(body.lastActiveQuestionRunRevision, 3)

  await sessions.close()
})

void test('responses route includes submitted, working, and idle progress entries for the instructor', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    responses?: Array<{ id: string; studentName: string }>
    progress?: Array<{ studentId: string; status: string; responseId: string | null }>
  }
  assert.equal(body.responses?.length, 1)
  assert.deepEqual(
    body.progress?.map((entry) => ({
      studentId: entry.studentId,
      status: entry.status,
      responseId: entry.responseId,
    })).sort((left, right) => left.studentId.localeCompare(right.studentId)),
    [
      { studentId: 'student1', status: 'submitted', responseId: 'r1' },
      { studentId: 'student2', status: 'working', responseId: null },
      { studentId: 'student3', status: 'idle', responseId: null },
    ],
  )

  await sessions.close()
})

void test('import-questions route appends a saved question set to an instructor session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/:sessionId/import-questions']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questions: [
          {
            id: 'q_imported_frq',
            type: 'free-response',
            text: 'What changed in your thinking?',
            order: 50,
          },
          {
            id: 'q_imported_mcq',
            type: 'multiple-choice',
            text: 'Which answers are valid?',
            order: 51,
            options: [
              { id: 'a', text: 'A', isCorrect: true },
              { id: 'b', text: 'B' },
            ],
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { questions?: Array<{ id: string; order: number }> }
  assert.deepEqual(body.questions?.map((question) => ({ id: question.id, order: question.order })), [
    { id: 'q_imported_frq', order: 1 },
    { id: 'q_imported_mcq', order: 2 },
  ])

  const stored = await sessions.get(session.id)
  const storedQuestions = (stored?.data as { questions?: Array<{ id: string; order: number }> } | undefined)?.questions ?? []
  assert.deepEqual(storedQuestions.map((question) => ({ id: question.id, order: question.order })), [
    { id: 'q1', order: 0 },
    { id: 'q_imported_frq', order: 1 },
    { id: 'q_imported_mcq', order: 2 },
  ])

  await sessions.close()
})

void test('import-questions route remaps duplicate question ids from separate sets', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/:sessionId/import-questions']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Replacement text',
            order: 99,
          },
          {
            id: 'q_new',
            type: 'free-response',
            text: 'New question',
            order: 100,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    ok?: boolean
    questions?: Array<{ id: string; type: string; text: string; order: number }>
    remappedQuestionIds?: Record<string, string>
  }
  const remappedQ1 = body.remappedQuestionIds?.q1
  assert.equal(body.ok, true)
  assert.equal(typeof remappedQ1, 'string')
  assert.notEqual(remappedQ1, 'q1')
  assert.match(remappedQ1 ?? '', /^q_imported_[\w-]+$/)
  assert.deepEqual(body.questions, [
    {
      id: remappedQ1,
      type: 'free-response',
      text: 'Replacement text',
      order: 1,
    },
    {
      id: 'q_new',
      type: 'free-response',
      text: 'New question',
      order: 2,
    },
  ])

  const stored = await sessions.get(session.id)
  const storedQuestions = (stored?.data as { questions?: Array<{ id: string; text: string; order: number }> } | undefined)?.questions ?? []
  assert.deepEqual(storedQuestions.map((question) => ({
    id: question.id,
    text: question.text,
    order: question.order,
  })), [
    { id: 'q1', text: 'Explain your reasoning.', order: 0 },
    { id: remappedQ1 ?? '', text: 'Replacement text', order: 1 },
    { id: 'q_new', text: 'New question', order: 2 },
  ])

  await sessions.close()
})

void test('activate-question route can activate all questions with a shared countdown and students can submit by questionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof stateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q1', 'q2'],
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    activeQuestionIds?: string[]
    activeQuestionRunStartedAt?: number | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.deepEqual(activateBody.activeQuestionIds, ['q1', 'q2'])
  assert.ok(typeof activateBody.activeQuestionDeadlineAt === 'number')

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const stateBody = stateRes.body as {
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
    activeQuestionRunStartedAt?: number | null
    activeQuestionRunRevision?: number | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.deepEqual(stateBody.activeQuestionIds, ['q1', 'q2'])
  assert.deepEqual(stateBody.activeQuestions?.map((question) => question.id), ['q1', 'q2'])
  assert.ok(typeof stateBody.activeQuestionDeadlineAt === 'number')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunRevision: stateBody.activeQuestionRunRevision,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  const stored = await sessions.get(session.id)
  const responses = (stored?.data as { responses?: Array<{ questionId: string; studentId: string }> } | undefined)?.responses ?? []
  assert.deepEqual(
    responses.map((response) => ({ questionId: response.questionId, studentId: response.studentId })),
    [{ questionId: 'q2', studentId: 'student1' }],
  )

  await sessions.close()
})

void test('staged activate-question hides MCQ choices until reveal and then accepts submissions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const revealHandler = app.handlers.post['/api/resonance/:sessionId/reveal-choices']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof revealHandler, 'function')
  assert.equal(typeof stateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    presentationMode?: string
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean } | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.equal(activateBody.presentationMode, 'staged')
  assert.equal(activateBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(activateBody.stagedRun?.choicesRevealed, false)
  assert.equal(activateBody.activeQuestionDeadlineAt, null)
  const storedAfterStagedActivate = await sessions.get(session.id)
  const stagedRunStartedAt = storedAfterStagedActivate?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof stagedRunStartedAt, 'number')
  const stagedRunRevision = (storedAfterStagedActivate?.data.activeQuestionRunRevision as number | null | undefined) ?? null

  const hiddenStateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, hiddenStateRes)

  assert.equal(hiddenStateRes.statusCode, 200)
  const hiddenState = hiddenStateRes.body as {
    activeQuestions?: Array<{ id: string; type: string; options?: unknown[]; choicesRevealed?: boolean }>
  }
  assert.deepEqual(hiddenState.activeQuestions?.[0], {
    id: 'q2',
    type: 'multiple-choice',
    text: 'Which option best fits?',
    order: 1,
    responseTimeLimitMs: 45000,
    options: [],
    selectionMode: 'single',
    choicesRevealed: false,
  })

  const blockedSubmitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunRevision: stagedRunRevision,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    blockedSubmitRes,
  )

  assert.equal(blockedSubmitRes.statusCode, 409)
  assert.deepEqual(blockedSubmitRes.body, { error: 'choices have not been revealed' })

  const revealRes = createResponse()
  await revealHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {},
    },
    revealRes,
  )

  assert.equal(revealRes.statusCode, 200)
  const revealBody = revealRes.body as {
    stagedRun?: { choicesRevealed?: boolean } | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.equal(revealBody.stagedRun?.choicesRevealed, true)
  assert.ok(typeof revealBody.activeQuestionDeadlineAt === 'number')
  const storedAfterReveal = await sessions.get(session.id)
  assert.equal(storedAfterReveal?.data.activeQuestionRunStartedAt, stagedRunStartedAt)

  const firstDeadlineAt = revealBody.activeQuestionDeadlineAt
  const repeatedRevealRes = createResponse()
  await revealHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {},
    },
    repeatedRevealRes,
  )

  assert.equal(repeatedRevealRes.statusCode, 200)
  assert.equal(
    (repeatedRevealRes.body as { activeQuestionDeadlineAt?: number | null }).activeQuestionDeadlineAt,
    firstDeadlineAt,
  )

  const visibleStateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, visibleStateRes)
  const visibleState = visibleStateRes.body as {
    activeQuestions?: Array<{ id: string; options?: unknown[]; choicesRevealed?: boolean }>
  }
  assert.equal(visibleState.activeQuestions?.[0]?.choicesRevealed, true)
  assert.equal(visibleState.activeQuestions?.[0]?.options?.length, 2)

  const expiredRunStartedAt = Date.now() - 3_000
  const expiredSession = await sessions.get(session.id)
  if (expiredSession) {
    expiredSession.data.activeQuestionRunStartedAt = expiredRunStartedAt
    const responseDrafts = expiredSession.data.responseDrafts as Record<string, unknown>
    responseDrafts['q2:student1'] = {
      questionId: 'q2',
      studentId: 'student1',
      updatedAt: Date.now() - 2_000,
      activeQuestionRunRevision: stagedRunRevision,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    }
    expiredSession.data.activeQuestionDeadlineAt = Date.now() - 1_000
    await sessions.set(session.id, expiredSession)
  }

  const expiredSubmitRes = createResponse()
  console.info('[TEST] submitting after expiry should return 409 after finalizing the persisted draft')
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunRevision: stagedRunRevision,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
        autoSubmit: true,
      },
    },
    expiredSubmitRes,
  )

  assert.equal(expiredSubmitRes.statusCode, 409)
  assert.deepEqual(expiredSubmitRes.body, { error: 'time is up for this question' })
  const finalizedSession = await sessions.get(session.id)
  const finalizedData = finalizedSession?.data as {
    responses: Array<{ questionId: string; studentId: string; answer: unknown }>
    responseDrafts: Record<string, unknown>
  } | undefined
  assert.deepEqual(
    finalizedData?.responses.find((response) =>
      response.questionId === 'q2' && response.studentId === 'student1')?.answer,
    { type: 'multiple-choice', selectedOptionIds: ['q2_b'] },
  )
  assert.equal(finalizedData?.responseDrafts['q2:student1'], undefined)

  const resetDeadlineSession = await sessions.get(session.id)
  if (resetDeadlineSession) {
    resetDeadlineSession.data.activeQuestionDeadlineAt = Date.now() + 45_000
    await sessions.set(session.id, resetDeadlineSession)
  }

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunRevision: stagedRunRevision,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  await sessions.close()
})

void test('staged session normalization deduplicates persisted question ids while preserving order', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.presentationMode = 'staged'
  session.data.stagedRun = {
    questionIds: ['q1', 'q2', 'q1', 'q2'],
    currentQuestionId: 'q2',
    currentIndex: 3,
    choicesRevealed: false,
    completedQuestionIds: ['q1', 'q1'],
  }
  session.data.activeQuestionId = 'q2'
  session.data.activeQuestionIds = ['q2']
  session.data.activeQuestionRunStartedAt = Date.now() - 500
  const originalRunStartedAt = session.data.activeQuestionRunStartedAt
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const responsesHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof responsesHandler, 'function')

  const res = createResponse()
  await responsesHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    activeQuestionRunStartedAt?: number | null
    stagedRun?: {
      questionIds?: string[]
      currentQuestionId?: string | null
      currentIndex?: number
      completedQuestionIds?: string[]
    } | null
  }
  assert.deepEqual(body.stagedRun?.questionIds, ['q1', 'q2'])
  assert.equal(body.stagedRun?.currentQuestionId, 'q2')
  assert.equal(body.stagedRun?.currentIndex, 1)
  assert.deepEqual(body.stagedRun?.completedQuestionIds, ['q1'])
  assert.equal(body.activeQuestionRunStartedAt, originalRunStartedAt)

  await sessions.close()
})

void test('activate-question pushes student state without student question-activated event', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  const studentMessages: Array<{ type?: string; payload?: unknown }> = []
  const instructorMessages: Array<{ type?: string; payload?: unknown }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: false,
    studentId: 'student1',
    send(message: string) {
      studentMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  assert.equal(typeof activateHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q1'],
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  assert.equal(studentMessages.some((message) => message.type === 'resonance:session-state'), true)
  assert.equal(studentMessages.some((message) => message.type === 'resonance:question-activated'), false)
  assert.equal(instructorMessages.some((message) => message.type === 'resonance:question-activated'), true)
  assert.equal(instructorMessages.some((message) => message.type === 'resonance:instructor-state'), true)

  await sessions.close()
})

void test('advance-staged-question moves through the staged sequence and ends after the last question', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const advanceHandler = app.handlers.post['/api/resonance/:sessionId/advance-staged-question']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof advanceHandler, 'function')

  const authHeaders = { 'x-instructor-passcode': 'TEACH123' }
  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {
        questionIds: ['q1', 'q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  assert.deepEqual((activateRes.body as { activeQuestionIds?: string[] }).activeQuestionIds, ['q1'])
  const firstStoredRun = await sessions.get(session.id)
  const firstRunStartedAt = firstStoredRun?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof firstRunStartedAt, 'number')

  const storedAfterActivate = await sessions.get(session.id)
  if (storedAfterActivate) {
    storedAfterActivate.data.activeQuestionRunStartedAt = 1_000
    storedAfterActivate.data.activeQuestionDeadlineAt = Date.now() - 1_000
    await sessions.set(session.id, storedAfterActivate)
  }

  const advanceToSecondRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    advanceToSecondRes,
  )

  assert.equal(advanceToSecondRes.statusCode, 200)
  const secondBody = advanceToSecondRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean; completedQuestionIds?: string[] } | null
  }
  assert.deepEqual(secondBody.activeQuestionIds, ['q2'])
  assert.equal(secondBody.activeQuestionDeadlineAt, null)
  assert.equal(secondBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(secondBody.stagedRun?.choicesRevealed, false)
  assert.deepEqual(secondBody.stagedRun?.completedQuestionIds, ['q1'])
  const secondStoredRun = await sessions.get(session.id)
  const secondRunStartedAt = secondStoredRun?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof secondRunStartedAt, 'number')
  assert.notEqual(secondRunStartedAt, 1_000)

  const endRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    endRes,
  )

  assert.equal(endRes.statusCode, 200)
  assert.deepEqual((endRes.body as { activeQuestionIds?: string[] }).activeQuestionIds, [])
  assert.equal((endRes.body as { stagedRun?: unknown }).stagedRun, null)

  await sessions.close()
})

void test('advance-staged-question can intentionally skip a stem-only MCQ', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Which option should be skipped?',
      order: 0,
      responseTimeLimitMs: 30_000,
      options: [
        { id: 'q1_a', text: 'Option A' },
        { id: 'q1_b', text: 'Option B' },
      ],
    },
    {
      id: 'q2',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 1,
      responseTimeLimitMs: 30_000,
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const advanceHandler = app.handlers.post['/api/resonance/:sessionId/advance-staged-question']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof advanceHandler, 'function')

  const authHeaders = { 'x-instructor-passcode': 'TEACH123' }
  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {
        questionIds: ['q1', 'q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean } | null
  }
  assert.deepEqual(activateBody.activeQuestionIds, ['q1'])
  assert.equal(activateBody.activeQuestionDeadlineAt, null)
  assert.equal(activateBody.stagedRun?.currentQuestionId, 'q1')
  assert.equal(activateBody.stagedRun?.choicesRevealed, false)

  const skipRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    skipRes,
  )

  assert.equal(skipRes.statusCode, 200)
  const skipBody = skipRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: {
      currentQuestionId?: string
      choicesRevealed?: boolean
      completedQuestionIds?: string[]
    } | null
  }
  assert.deepEqual(skipBody.activeQuestionIds, ['q2'])
  assert.ok(typeof skipBody.activeQuestionDeadlineAt === 'number')
  assert.equal(skipBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(skipBody.stagedRun?.choicesRevealed, true)
  assert.deepEqual(skipBody.stagedRun?.completedQuestionIds, ['q1'])

  await sessions.close()
})

void test('submit-answer route broadcasts an updated instructor snapshot to instructor displays', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  const instructorMessages: Array<{ type?: string; payload?: unknown }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activatedSession = await sessions.get(session.id)
  const activeQuestionRunRevision = activatedSession?.data.activeQuestionRunRevision

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunRevision,
        answer: {
          type: 'free-response',
          text: 'Updated live answer',
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)
  let instructorStateMessage: { type?: string; payload?: unknown } | undefined
  for (let index = instructorMessages.length - 1; index >= 0; index -= 1) {
    const message = instructorMessages[index]
    if (message?.type === 'resonance:instructor-state') {
      instructorStateMessage = message
      break
    }
  }
  assert.notEqual(instructorStateMessage, undefined)
  const payload = instructorStateMessage?.payload as {
    responses?: Array<{ questionId?: string; studentId?: string; answer?: { text?: string } }>
  }
  assert.equal(payload.responses?.some((response) =>
    response.questionId === 'q1' &&
    response.studentId === 'student1' &&
    response.answer?.text === 'Updated live answer'
  ), true)

  await sessions.close()
})

void test('submit-answer route updates an existing response when a question is reactivated', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-reactivate',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionRunStartedAt: now - 1_000,
      activeQuestionRunRevision: 1,
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: 1,
          answer: {
            type: 'free-response',
            text: 'Initial answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof submitHandler, 'function')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunRevision: 1,
        answer: {
          type: 'free-response',
          text: 'Revised answer',
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  const stored = await sessions.get(session.id)
  const responses = (stored?.data as { responses?: Array<{ id: string; answer: { type: string; text?: string } }> } | undefined)?.responses ?? []
  assert.equal(responses.length, 1)
  assert.equal(responses[0]?.id, 'r1')
  assert.deepEqual(responses[0]?.answer, {
    type: 'free-response',
    text: 'Revised answer',
  })

  await sessions.close()
})

void test('reactivating a question keeps prior answers editable for students and marks them working for instructors', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  const responsesHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')
  assert.equal(typeof responsesHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const firstActivateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    firstActivateRes,
  )
  assert.equal(firstActivateRes.statusCode, 200)
  const firstActivatedSession = await sessions.get(session.id)
  const firstRunRevision = firstActivatedSession?.data.activeQuestionRunRevision

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunRevision: firstRunRevision,
        answer: {
          type: 'free-response',
          text: 'First run answer',
        },
      },
    },
    submitRes,
  )
  assert.equal(submitRes.statusCode, 200)

  const secondActivateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    secondActivateRes,
  )
  assert.equal(secondActivateRes.statusCode, 200)
  const secondActivatedSession = await sessions.get(session.id)
  assert.equal(secondActivatedSession?.data.activeQuestionRunRevision, Number(firstRunRevision) + 1)

  const staleSubmitRes = createResponse()
  console.info('[TEST] a submission from the previous run should return 409')
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      cookies: studentCookies,
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunRevision: firstRunRevision,
        answer: {
          type: 'free-response',
          text: 'Delayed first run answer',
        },
      },
    },
    staleSubmitRes,
  )
  assert.equal(staleSubmitRes.statusCode, 409)
  assert.deepEqual(staleSubmitRes.body, { error: 'question run changed' })

  const studentStateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
      cookies: studentCookies,
    },
    studentStateRes,
  )
  assert.equal(studentStateRes.statusCode, 200)
  assert.deepEqual(
    (studentStateRes.body as { submittedAnswers?: Record<string, unknown> }).submittedAnswers,
    {
      q1: {
        type: 'free-response',
        text: 'First run answer',
      },
    },
  )

  const responsesRes = createResponse()
  await responsesHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    responsesRes,
  )

  assert.equal(responsesRes.statusCode, 200)
  const body = responsesRes.body as {
    progress?: Array<{ questionId?: string; studentId?: string; status?: string; answer?: { text?: string } }>
  }
  assert.equal(body.progress?.some((entry) =>
    entry.questionId === 'q1' &&
    entry.studentId === 'student1' &&
    entry.status === 'working' &&
    entry.answer?.text === 'First run answer'
  ), true)

  await sessions.close()
})

void test('share-results replaces any previously shared reveal so only one reveal remains active', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-share-replace',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
        {
          id: 'q2',
          type: 'free-response',
          text: 'Revise your answer.',
          order: 1,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'Initial answer',
          },
        },
        {
          id: 'r2',
          questionId: 'q2',
          studentId: 'student1',
          submittedAt: now - 250,
          answer: {
            type: 'free-response',
            text: 'Revised answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const shareHandler = app.handlers.post['/api/resonance/:sessionId/share-results']
  assert.equal(typeof shareHandler, 'function')

  const res = createResponse()
  await shareHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q2',
        selectedResponseIds: ['r2'],
        correctOptionIds: null,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const stored = await sessions.get(session.id)
  const reveals = (stored?.data as { reveals?: Array<{ questionId: string }> } | undefined)?.reveals ?? []
  assert.deepEqual(reveals.map((reveal) => reveal.questionId), ['q2'])

  await sessions.close()
})

void test('stop-sharing route clears the current shared reveal without requiring a question id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-stop-sharing',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {},
      responses: [],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [],
        },
      ],
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stopSharingHandler = app.handlers.post['/api/resonance/:sessionId/stop-sharing']
  assert.equal(typeof stopSharingHandler, 'function')

  const res = createResponse()
  await stopSharingHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const stored = await sessions.get(session.id)
  const reveals = (stored?.data as { reveals?: Array<{ questionId: string }> } | undefined)?.reveals ?? []
  assert.deepEqual(reveals, [])

  await sessions.close()
})

void test('student state includes the viewer response and marks when their shared response is their own', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const submittedAt = now - 500
  const session: SessionRecord = {
    id: 'resonance-session-student-reveal',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt,
          activeQuestionRunRevision: null,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '👏',
        },
      },
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: '👏',
              reactions: {},
            },
          ],
        },
      ],
      sharedResponseReactions: {
        r1: {
          student1: '🔥',
        },
      },
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ isOwnResponse?: boolean; viewerReaction?: string | null }>
      viewerResponse?: { instructorEmoji?: string | null; isShared?: boolean; answer?: { text?: string } }
    }>
  }
  assert.equal(body.reveals?.[0]?.sharedResponses?.[0]?.isOwnResponse, true)
  assert.equal(body.reveals?.[0]?.sharedResponses?.[0]?.viewerReaction, '🔥')
  assert.deepEqual(body.reveals?.[0]?.viewerResponse, {
    answer: {
      type: 'free-response',
      text: 'My answer',
    },
    submittedAt,
    instructorEmoji: '👏',
    isShared: true,
  })

  await sessions.close()
})

void test('annotate-response route updates the student viewer response emoji for shared results', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const submittedAt = now - 500
  const session: SessionRecord = {
    id: 'resonance-session-annotation-student-view',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt,
          activeQuestionRunRevision: null,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: null,
        },
      },
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: null,
              reactions: {},
            },
          ],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const annotateHandler = app.handlers.post['/api/resonance/:sessionId/annotate-response']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof annotateHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const annotateRes = createResponse()
  await annotateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        responseId: 'r1',
        annotation: {
          emoji: '💡',
        },
      },
    },
    annotateRes,
  )

  assert.equal(annotateRes.statusCode, 200)

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const body = stateRes.body as {
    reveals?: Array<{
      viewerResponse?: { instructorEmoji?: string | null; answer?: { text?: string } }
    }>
  }
  assert.equal(body.reveals?.[0]?.viewerResponse?.instructorEmoji, '💡')
  assert.equal(body.reveals?.[0]?.viewerResponse?.answer?.text, 'My answer')

  await sessions.close()
})

void test('student state sanitizes malformed stored reveal reactions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-sanitize-reactions',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: null,
              reactions: {
                '🔥': 2,
                '👏': -1,
                bad: 3,
                '💡': Number.NaN,
              },
            },
          ],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ reactions?: Record<string, number> }>
    }>
  }
  assert.deepEqual(body.reveals?.[0]?.sharedResponses?.[0]?.reactions, {
    '🔥': 2,
  })

  await sessions.close()
})

void test('a stored response or draft with a corrupted or absent activeQuestionRunRevision is dropped, not treated as self-paced', async () => {
  // Copilot review of PR #381 (two rounds): normalizeStoredResponses/
  // normalizeResponseDrafts used to coerce ANY invalid activeQuestionRunRevision
  // (a string, NaN, a negative number, or an omitted field) down to `null` —
  // the same value a genuine self-paced/idle write uses. `activeQuestionRunRevision`
  // is a required `number | null` field on both `Response` and a stored
  // draft, and `upsertResponse`/the update-draft handler always write it
  // explicitly (never omit it); per AGENTS.md rule 17 (no legacy-session
  // migration — this is a from-scratch field with a single writer, not one
  // predated by an older shape), a stored value that's neither an explicit
  // `null` nor a positive safe integer — including the field being entirely
  // absent — can only be data corruption. Coercing it to `null` made it
  // indistinguishable from a legitimate self-paced record, letting it
  // silently match a self-paced/idle session's run identity (the same
  // hazard fixed for incoming live writes in matchesActiveQuestionRun,
  // follow-up 5). A corrupted response could then wrongly satisfy the
  // update-draft handler's confirmedResponseForRun staleness check and block
  // a genuinely new self-paced edit. Fixed by dropping the entry entirely
  // whenever its activeQuestionRunRevision fails validation (present-and-invalid
  // or absent), matching how the same functions already drop entries with
  // other invalid required fields (missing id/questionId/studentId, invalid
  // answer).
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-corrupted-run-revision',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      selfPacedMode: true,
      questions: [
        { id: 'q1', type: 'free-response', text: 'Explain your reasoning.', order: 0 },
        { id: 'q2', type: 'free-response', text: 'Explain further.', order: 1 },
        { id: 'q3', type: 'free-response', text: 'Explain once more.', order: 2 },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r-corrupt',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: 'not-a-number',
          editSequence: 5,
          answer: { type: 'free-response', text: 'Corrupted-revision answer' },
        },
        {
          id: 'r-genuine',
          questionId: 'q2',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: null,
          editSequence: 1,
          answer: { type: 'free-response', text: 'Genuine self-paced answer' },
        },
        {
          id: 'r-absent',
          questionId: 'q3',
          studentId: 'student1',
          submittedAt: now - 500,
          editSequence: 3,
          answer: { type: 'free-response', text: 'Absent-revision answer' },
        },
      ],
      responseDrafts: {
        'q1:student1': {
          questionId: 'q1',
          studentId: 'student1',
          updatedAt: now - 100,
          activeQuestionRunRevision: -1,
          editSequence: 2,
          draftSendSequence: 1,
          answer: { type: 'free-response', text: 'Corrupted-revision draft' },
        },
      },
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    submittedAnswers?: Record<string, { text?: string }>
    submittedResponseEditSequences?: Record<string, number>
    draftAnswers?: Record<string, { text?: string }>
  }
  assert.equal(body.submittedAnswers?.q1, undefined, 'the corrupted-revision response must not surface')
  assert.equal(body.submittedResponseEditSequences?.q1, undefined)
  assert.equal(body.submittedAnswers?.q2?.text, 'Genuine self-paced answer', 'the genuine self-paced response must still surface')
  assert.equal(body.submittedAnswers?.q3, undefined, 'the absent-revision response must not surface')
  assert.equal(body.draftAnswers?.q1, undefined, 'the corrupted-revision draft must not surface')

  await sessions.close()
})

void test('student state includes reviewed responses for annotated answers that were not shared publicly', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-private-feedback',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: null,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '💡',
        },
      },
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: unknown[]
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { text?: string }
    }>
  }
  assert.deepEqual(body.reveals, [])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'My answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.text, 'Explain your reasoning.')

  await sessions.close()
})

void test('student state hides reviewed responses for annotated answers when the question is active again', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-private-feedback-reactivated',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          // Submitted before this reactivation.
          activeQuestionRunRevision: null,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '💡',
        },
      },
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reviewedResponses?: unknown[]
    submittedAnswers?: Record<string, { text?: string }>
  }
  assert.deepEqual(body.reviewedResponses, [])
  assert.equal(body.submittedAnswers?.q1?.text, 'My answer')

  await sessions.close()
})

void test('student state reports each confirmed response\'s editSequence, so a reloaded client can seed its counter past it', async () => {
  // A client that reloads mid-run has no in-memory edit-sequence bookkeeping
  // (that counter only ever lived in a ref) and would otherwise default a
  // post-reload revision to sequence 1. If a confirmed response is already at
  // sequence 1+, that revision would be silently dropped as stale by the
  // update-draft/submit-answer guard below. submittedResponseEditSequences
  // lets the client seed its local counter from the server's authoritative
  // value instead of guessing 1.
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-reload-edit-sequence',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionRunStartedAt: now - 5_000,
      activeQuestionRunRevision: 1,
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          activeQuestionRunRevision: 1,
          editSequence: 2,
          answer: {
            type: 'free-response',
            text: 'Revised before reload',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    submittedResponseEditSequences?: Record<string, number>
  }
  assert.equal(body.submittedResponseEditSequences?.q1, 2)

  await sessions.close()
})

void test('student state reports each draft\'s draftSendSequence, so a reloaded client can seed its own send counter past it', async () => {
  // Regression test (Copilot review of PR #381): the client's own
  // draftSendSequence counter is component-local and restarts at 0 on a
  // page reload, while the server retains whatever value was already
  // stored on the draft. Without exposing that stored value back to the
  // client, its first post-reload send (even a plain, non-revisit edit —
  // same editSequence as what's already stored) would carry a lower
  // draftSendSequence than the server already has, and the update-draft
  // ordering guard would reject it as stale, silently dropping the edit.
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-reload-draft-send-sequence',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionRunStartedAt: now - 5_000,
      activeQuestionRunRevision: 1,
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [],
      responseDrafts: {
        'q1:student1': {
          questionId: 'q1',
          studentId: 'student1',
          updatedAt: now - 200,
          activeQuestionRunRevision: 1,
          editSequence: 1,
          draftSendSequence: 7,
          answer: { type: 'free-response', text: 'Typed before the reload' },
        },
      },
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  const studentCookies = issueStudentCookies(session, 'student1')
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
      cookies: studentCookies,
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    draftAnswers?: Record<string, unknown>
    draftSendSequences?: Record<string, number>
  }
  assert.deepEqual(body.draftAnswers?.q1, { type: 'free-response', text: 'Typed before the reload' })
  assert.equal(body.draftSendSequences?.q1, 7)

  await sessions.close()
})
