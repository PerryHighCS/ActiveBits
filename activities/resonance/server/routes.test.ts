import { createSessionStore, type SessionRecord } from 'activebits-server/core/sessions.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WsRouter } from '../../../types/websocket.js'
import setupResonanceRoutes from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  cookies?: Record<string, unknown>
  headers?: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
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
      query: { studentId: 'student1' },
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
      answer: {
        type: 'multiple-choice',
        selectedOptionId: 'q2_b',
      },
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    reveals?: Array<{
      questionId?: string
      correctOptionIds?: string[] | null
      viewerResponse?: {
        answer?: { type?: string; selectedOptionId?: string }
      } | null
    }>
  }
  assert.deepEqual(body.reveals?.map((reveal) => reveal.questionId), ['q2'])
  assert.deepEqual(body.reveals?.[0]?.correctOptionIds, ['q2_a'])
  assert.deepEqual(body.reveals?.[0]?.viewerResponse?.answer, {
    type: 'multiple-choice',
    selectedOptionId: 'q2_b',
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
  const body = res.body as { selectedOptions?: { q?: string; h?: string } }
  assert.equal(typeof body.selectedOptions?.q, 'string')
  assert.equal(typeof body.selectedOptions?.h, 'string')
  assert.ok((body.selectedOptions?.q ?? '').length > 0)
  assert.equal((body.selectedOptions?.h ?? '').length, 20)

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

void test('activate-question route can activate all questions with a shared countdown and students can submit by questionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
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
    activeQuestionDeadlineAt?: number | null
  }
  assert.deepEqual(stateBody.activeQuestionIds, ['q1', 'q2'])
  assert.deepEqual(stateBody.activeQuestions?.map((question) => question.id), ['q1', 'q2'])
  assert.ok(typeof stateBody.activeQuestionDeadlineAt === 'number')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q2',
        answer: {
          type: 'multiple-choice',
          selectedOptionId: 'q2_b',
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

void test('submit-answer route broadcasts an updated instructor snapshot to instructor displays', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
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

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
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
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof submitHandler, 'function')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
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

void test('reactivating a question marks prior answers as working instead of submitted in the instructor snapshot', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  const responsesHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')
  assert.equal(typeof responsesHandler, 'function')

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

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
        answer: {
          type: 'free-response',
          text: 'First run answer',
        },
      },
    },
    submitRes,
  )
  assert.equal(submitRes.statusCode, 200)
  await new Promise((resolve) => setTimeout(resolve, 2))

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
