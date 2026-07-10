import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import setupPostboardRoutes, {
  buildInstructorSnapshot,
  buildReactionCounts,
  buildStudentSnapshot,
  normalizePostboardSessionData,
} from './routes.js'
import type { PostboardPost, PostboardSessionData } from '../shared/types.js'

interface HandlerRequest {
  params: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, unknown>
  headers?: Record<string, unknown>
}

interface HandlerResponse {
  statusCode: number
  body: unknown
  status(code: number): HandlerResponse
  json(payload: unknown): void
}

type Handler = (req: HandlerRequest, res: HandlerResponse) => void | Promise<void>

class TestApp {
  readonly handlers = {
    get: {} as Record<string, Handler>,
    post: {} as Record<string, Handler>,
  }

  get(path: string, handler: Handler): void {
    this.handlers.get[path] = handler
  }

  post(path: string, handler: Handler): void {
    this.handlers.post[path] = handler
  }
}

class MemoryStore implements SessionStore {
  readonly sessions = new Map<string, SessionRecord>()
  readonly ttlMs = 60 * 60 * 1000

  async get(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null
  }

  async set(id: string, session: SessionRecord): Promise<void> {
    this.sessions.set(id, session)
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id)
  }

  async touch(id: string): Promise<boolean> {
    return this.sessions.has(id)
  }

  async getAll(): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
  }

  async getAllIds(): Promise<string[]> {
    return [...this.sessions.keys()]
  }

  cleanup(): void {}

  async close(): Promise<void> {}
}

function createResponse(): HandlerResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
    },
  }
}

function createWsRouter(): WsRouter {
  return {
    wss: {
      clients: new Set<ActiveBitsWebSocket>(),
      close(callback?: () => void): void {
        callback?.()
      },
    },
    register(): void {},
  }
}

function createBroadcastCapture(sessionId = 'session-1'): { ws: WsRouter; messages: string[] } {
  const messages: string[] = []
  const socket = {
    readyState: 1,
    sessionId,
    send(message: string) {
      messages.push(message)
    },
  } as ActiveBitsWebSocket
  const ws = createWsRouter()
  ws.wss.clients.add(socket)
  return { ws, messages }
}

function createSession(data: Partial<PostboardSessionData> = {}): SessionRecord & { type: 'postboard'; data: PostboardSessionData } {
  return {
    id: 'session-1',
    type: 'postboard',
    created: 100,
    lastActivity: 100,
    data: normalizePostboardSessionData({
      instructorPasscode: 'teacher-pass',
      prompt: {
        id: 'prompt-1',
        text: 'What did you notice?',
        createdAt: 100,
        updatedAt: 100,
      },
      settings: {
        autoApprove: false,
      },
      posts: [],
      reactions: {},
      flags: {},
      ...data,
    }),
  }
}

function createPost(overrides: Partial<PostboardPost> = {}): PostboardPost {
  return {
    id: 'post-1',
    promptId: 'prompt-1',
    authorId: 'student-1',
    authorName: 'Ada Lovelace',
    authorRole: 'student',
    text: 'A note',
    styleId: 'lemon',
    createdAt: 100,
    updatedAt: 100,
    status: 'approved',
    approvedAt: 100,
    rejectedAt: null,
    deletedAt: null,
    hiddenAt: null,
    order: 0,
    ...overrides,
  }
}

void test('normalizePostboardSessionData applies selected option defaults and repairs shapes', () => {
  const data = normalizePostboardSessionData({
    selectedOptions: {
      prompt: '  Share a debugging strategy  ',
      autoApprove: 'true',
    },
    posts: [
      {
        id: 'p1',
        text: '  Use print statements  ',
        authorId: 'student-1',
        authorName: 'Ada',
        status: 'approved',
        createdAt: 100,
      },
    ],
    reactions: {
      p1: {
        byUser: {
          'student-2': '👍',
          'student-3': 'not-real',
        },
      },
    },
  })

  assert.equal(data.prompt.text, 'Share a debugging strategy')
  assert.equal(data.settings.autoApprove, true)
  assert.equal(data.posts[0]?.approvedAt, 100)
  assert.deepEqual(data.reactions.p1?.byUser, { 'student-2': '👍' })
  assert.equal(typeof data.instructorPasscode, 'string')
})

void test('student snapshot hides peer names, pending posts, hidden posts, flags, and raw reactions', () => {
  const session = createSession({
    posts: [
      {
        id: 'pending-own',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Pending own note',
        styleId: 'lemon',
        createdAt: 99,
        updatedAt: 99,
        status: 'pending',
        approvedAt: null,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: -1,
      },
      {
        id: 'approved-peer',
        promptId: 'prompt-1',
        authorId: 'student-2',
        authorName: 'Grace Hopper',
        authorRole: 'student',
        text: 'Approved peer note',
        styleId: 'lemon',
        createdAt: 100,
        updatedAt: 100,
        status: 'approved',
        approvedAt: 100,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: 0,
      },
      {
        id: 'pending-peer',
        promptId: 'prompt-1',
        authorId: 'student-2',
        authorName: 'Grace Hopper',
        authorRole: 'student',
        text: 'Pending peer note',
        styleId: 'lemon',
        createdAt: 101,
        updatedAt: 101,
        status: 'pending',
        approvedAt: null,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: 1,
      },
      {
        id: 'rejected-own',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Returned own note',
        styleId: 'lemon',
        createdAt: 102,
        updatedAt: 102,
        status: 'rejected',
        approvedAt: null,
        rejectedAt: 103,
        deletedAt: null,
        hiddenAt: null,
        order: 2,
      },
    ],
    reactions: {
      'approved-peer': {
        byUser: {
          'student-1': '👍',
        },
      },
    },
    flags: {
      'approved-peer': [
        {
          id: 'flag-1',
          postId: 'approved-peer',
          flaggedBy: 'instructor',
          createdAt: 105,
        },
      ],
    },
  })

  const snapshot = buildStudentSnapshot(session, 'student-1')

  assert.deepEqual(snapshot.posts.map((post) => post.id), ['pending-own', 'approved-peer', 'rejected-own'])
  assert.equal(snapshot.posts[0]?.isOwnPost, true)
  assert.equal(snapshot.posts[0]?.status, 'pending')
  assert.equal(snapshot.posts[1]?.authorLabel, 'Student')
  assert.equal('authorName' in (snapshot.posts[1] ?? {}), false)
  assert.equal(snapshot.posts[2]?.isOwnPost, true)
  assert.equal(snapshot.posts[2]?.status, 'rejected')
  assert.deepEqual(snapshot.reactionCounts, { 'approved-peer': { '👍': 1 } })
  assert.equal('flags' in snapshot, false)
  assert.equal('reactions' in snapshot, false)
})

void test('student snapshot excludes reaction counts for non-visible posts', () => {
  const basePost = {
    promptId: 'prompt-1',
    authorId: 'student-2',
    authorName: 'Grace Hopper',
    authorRole: 'student' as const,
    text: 'Peer note',
    styleId: 'lemon',
    createdAt: 100,
    updatedAt: 100,
    approvedAt: null,
    rejectedAt: null,
    deletedAt: null,
    hiddenAt: null,
    order: 0,
  }
  const session = createSession({
    posts: [
      {
        ...basePost,
        id: 'approved-visible',
        status: 'approved',
        approvedAt: 100,
      },
      {
        ...basePost,
        id: 'pending-peer',
        status: 'pending',
        order: 1,
      },
      {
        ...basePost,
        id: 'hidden-peer',
        status: 'approved',
        approvedAt: 102,
        hiddenAt: 103,
        order: 2,
      },
      {
        ...basePost,
        id: 'deleted-peer',
        status: 'deleted',
        deletedAt: 104,
        order: 3,
      },
      {
        ...basePost,
        id: 'rejected-peer',
        status: 'rejected',
        rejectedAt: 105,
        order: 4,
      },
    ],
    reactions: {
      'approved-visible': { byUser: { 'student-1': '👍' } },
      'pending-peer': { byUser: { 'student-3': '🤔' } },
      'hidden-peer': { byUser: { 'student-3': '❤️' } },
      'deleted-peer': { byUser: { 'student-3': '🔥' } },
      'rejected-peer': { byUser: { 'student-3': '💡' } },
    },
  })

  const snapshot = buildStudentSnapshot(session, 'student-1')

  assert.deepEqual(snapshot.posts.map((post) => post.id), ['approved-visible'])
  assert.deepEqual(snapshot.reactionCounts, { 'approved-visible': { '👍': 1 } })
})

void test('instructor snapshot includes names, flags, and moderation states', () => {
  const session = createSession({
    posts: [
      {
        id: 'pending-peer',
        promptId: 'prompt-1',
        authorId: 'student-2',
        authorName: 'Grace Hopper',
        authorRole: 'student',
        text: 'Pending peer note',
        styleId: 'lemon',
        createdAt: 101,
        updatedAt: 101,
        status: 'pending',
        approvedAt: null,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: 1,
      },
    ],
    flags: {
      'pending-peer': [
        {
          id: 'flag-1',
          postId: 'pending-peer',
          flaggedBy: 'instructor',
          createdAt: 105,
        },
      ],
    },
  })

  const snapshot = buildInstructorSnapshot(session)

  assert.equal(snapshot.posts[0]?.authorName, 'Grace Hopper')
  assert.equal(snapshot.posts[0]?.status, 'pending')
  assert.equal(snapshot.flags['pending-peer']?.length, 1)
})

void test('buildReactionCounts deduplicates by reactor and supports changed reactions', () => {
  const counts = buildReactionCounts({
    post1: {
      byUser: {
        student1: '👍',
        student2: '👍',
        student3: '🤔',
      },
    },
  })

  assert.deepEqual(counts, {
    post1: {
      '👍': 2,
      '🤔': 1,
    },
  })
})

void test('instructor-state route rejects missing passcode and accepts valid passcode', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession()
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.get['/api/postboard/:sessionId/instructor-state']
  assert.ok(handler)

  const rejected = createResponse()
  await handler({ params: { sessionId: session.id }, headers: {} }, rejected)
  assert.equal(rejected.statusCode, 403)

  const accepted = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
  }, accepted)
  assert.equal(accepted.statusCode, 200)
  assert.equal((accepted.body as { prompt?: { text?: string } }).prompt?.text, 'What did you notice?')
})

void test('post submit route keeps manual student notes pending and instructor notes approved', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
  } as Partial<PostboardSessionData>)
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/:sessionId/posts']
  assert.ok(handler)

  const studentResponse = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: {
      studentId: 'student-1',
      text: 'Student note',
    },
  }, studentResponse)

  const instructorResponse = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: {
      text: 'Instructor note',
    },
  }, instructorResponse)

  const stored = await store.get(session.id)
  const storedData = stored?.data as PostboardSessionData | undefined
  assert.equal(storedData?.posts[0]?.status, 'pending')
  assert.equal(storedData?.posts[0]?.authorName, 'Ada Lovelace')
  assert.equal(storedData?.posts[1]?.status, 'approved')
  assert.equal(storedData?.posts[1]?.authorRole, 'instructor')

  const spoofedStudentResponse = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: {
      studentId: 'student-2',
      text: 'Spoofed note',
    },
  }, spoofedStudentResponse)
  assert.equal(spoofedStudentResponse.statusCode, 403)
})

void test('create route generates instructor passcode and applies selected option defaults', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/create']
  assert.ok(handler)

  const response = createResponse()
  await handler({
    params: {},
    body: {
      selectedOptions: {
        prompt: '  What changed your mind?  ',
        autoApprove: 'true',
      },
    },
  }, response)

  assert.equal(response.statusCode, 200)
  const body = response.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof body.id, 'string')
  assert.equal(typeof body.instructorPasscode, 'string')

  const stored = body.id ? await store.get(body.id) : null
  const storedData = stored?.data as PostboardSessionData | undefined
  assert.equal(stored?.type, 'postboard')
  assert.equal(storedData?.prompt.text, 'What changed your mind?')
  assert.equal(storedData?.settings.autoApprove, true)
  assert.equal(storedData?.instructorPasscode, body.instructorPasscode)
})

void test('student-state route returns a student-safe snapshot for the requester', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
    posts: [
      createPost({
        id: 'approved-peer',
        authorId: 'student-2',
        authorName: 'Grace Hopper',
        text: 'Visible peer note',
      }),
      createPost({
        id: 'pending-own',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        text: 'Waiting for review',
        status: 'pending',
        approvedAt: null,
        order: 1,
      }),
      createPost({
        id: 'pending-peer',
        authorId: 'student-3',
        authorName: 'Katherine Johnson',
        text: 'Hidden peer note',
        status: 'pending',
        approvedAt: null,
        order: 2,
      }),
    ],
    reactions: {
      'approved-peer': { byUser: { 'student-1': '👍' } },
      'pending-peer': { byUser: { 'student-4': '🔥' } },
    },
  })
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.get['/api/postboard/:sessionId/student-state']
  assert.ok(handler)

  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    query: { studentId: 'student-1' },
  }, response)

  assert.equal(response.statusCode, 200)
  const body = response.body as ReturnType<typeof buildStudentSnapshot>
  assert.deepEqual(body.posts.map((post) => post.id), ['approved-peer', 'pending-own'])
  assert.equal(body.posts[0]?.authorLabel, 'Student')
  assert.equal(body.posts[1]?.isOwnPost, true)
  assert.equal('authorName' in (body.posts[0] ?? {}), false)
  assert.deepEqual(body.reactionCounts, { 'approved-peer': { '👍': 1 } })
  assert.deepEqual(body.viewerReactions, { 'approved-peer': '👍' })

  const spoofedResponse = createResponse()
  await handler({
    params: { sessionId: session.id },
    query: { studentId: 'student-3' },
  }, spoofedResponse)
  assert.equal(spoofedResponse.statusCode, 200)
  const spoofedBody = spoofedResponse.body as ReturnType<typeof buildStudentSnapshot>
  assert.deepEqual(spoofedBody.posts.map((post) => post.id), ['approved-peer'])
})

void test('setup route requires instructor auth, persists prompt settings, and broadcasts', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession()
  const { ws, messages } = createBroadcastCapture(session.id)
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, ws)

  const handler = app.handlers.post['/api/postboard/:sessionId/setup']
  assert.ok(handler)

  const rejected = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: { prompt: 'Nope', autoApprove: true },
  }, rejected)
  assert.equal(rejected.statusCode, 403)
  assert.equal(messages.length, 0)

  const accepted = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { prompt: '  Updated prompt  ', autoApprove: 'true' },
  }, accepted)

  assert.equal(accepted.statusCode, 200)
  const stored = await store.get(session.id)
  const storedData = stored?.data as PostboardSessionData | undefined
  assert.equal(storedData?.prompt.text, 'Updated prompt')
  assert.equal(storedData?.settings.autoApprove, true)
  assert.deepEqual(messages, [JSON.stringify({ type: 'postboard:updated', sessionId: session.id })])
})

void test('post route rejects new posts once the session reaches the post limit', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const posts = Array.from({ length: 500 }, (_, index) => createPost({
    id: `post-${index}`,
    text: `Note ${index}`,
    createdAt: index,
    updatedAt: index,
    approvedAt: index,
    order: index,
  }))
  const session = createSession({
    acceptedEntryParticipants: {
      'student-501': {
        participantId: 'student-501',
        displayName: 'Overflow Student',
        acceptedAt: 100,
      },
    },
    posts,
  })
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/:sessionId/posts']
  assert.ok(handler)

  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: { studentId: 'student-501', text: 'One note too many' },
  }, response)

  assert.equal(response.statusCode, 409)
  assert.deepEqual(response.body, { error: 'post limit reached' })
  const stored = await store.get(session.id)
  const storedData = stored?.data as PostboardSessionData | undefined
  assert.equal(storedData?.posts.length, 500)
})

void test('hide and unhide routes require instructor auth, update hiddenAt, and broadcast', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    posts: [createPost()],
  })
  const { ws, messages } = createBroadcastCapture(session.id)
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, ws)

  const hide = app.handlers.post['/api/postboard/:sessionId/posts/:postId/hide']
  const unhide = app.handlers.post['/api/postboard/:sessionId/posts/:postId/unhide']
  assert.ok(hide)
  assert.ok(unhide)

  const rejected = createResponse()
  await hide({
    params: { sessionId: session.id, postId: 'post-1' },
    body: {},
  }, rejected)
  assert.equal(rejected.statusCode, 403)
  assert.equal(messages.length, 0)

  const hidden = createResponse()
  await hide({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
  }, hidden)
  assert.equal(hidden.statusCode, 200)
  assert.equal(typeof ((hidden.body as { posts?: PostboardPost[] }).posts?.[0]?.hiddenAt), 'number')
  assert.equal(messages.length, 1)

  const unhidden = createResponse()
  await unhide({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
  }, unhidden)
  assert.equal(unhidden.statusCode, 200)
  assert.equal((unhidden.body as { posts?: PostboardPost[] }).posts?.[0]?.hiddenAt, null)
  assert.equal(messages.length, 2)
})

void test('reorder route applies provided post order and normalizes omitted board posts', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
    posts: [
      createPost({ id: 'post-a', order: 0, text: 'A' }),
      createPost({ id: 'post-b', order: 1, text: 'B' }),
      createPost({ id: 'post-c', order: 2, text: 'C' }),
      createPost({ id: 'pending-post', order: 3, text: 'Pending', status: 'pending', approvedAt: null }),
    ],
  })
  const { ws, messages } = createBroadcastCapture(session.id)
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, ws)

  const handler = app.handlers.post['/api/postboard/:sessionId/reorder']
  assert.ok(handler)

  const rejected = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: { postIds: ['post-c', 'post-a'] },
  }, rejected)
  assert.equal(rejected.statusCode, 403)
  assert.equal(messages.length, 0)

  const accepted = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { postIds: ['post-c', 'missing-post', 'post-c', 'post-a'] },
  }, accepted)

  assert.equal(accepted.statusCode, 200)
  const body = accepted.body as { posts?: PostboardPost[] }
  assert.deepEqual(body.posts?.map((post) => post.id), ['post-c', 'post-a', 'post-b', 'pending-post'])
  assert.deepEqual(body.posts?.map((post) => post.order), [0, 1, 2, 3])
  assert.equal(messages.length, 1)
})

void test('react route validates input, protects hidden and self posts, and toggles reactions', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
    posts: [
      createPost({
        id: 'peer-approved',
        authorId: 'student-2',
        text: 'Visible peer note',
      }),
      createPost({
        id: 'own-approved',
        authorId: 'student-1',
        text: 'Own visible note',
        order: 1,
      }),
      createPost({
        id: 'pending-peer',
        authorId: 'student-2',
        status: 'pending',
        approvedAt: null,
        order: 2,
      }),
      createPost({
        id: 'hidden-peer',
        authorId: 'student-2',
        hiddenAt: 120,
        order: 3,
      }),
    ],
    reactions: {
      'hidden-peer': { byUser: { 'student-3': '🔥' } },
      'own-approved': { byUser: { 'student-2': '👍' } },
    },
  })
  const { ws, messages } = createBroadcastCapture(session.id)
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, ws)

  const handler = app.handlers.post['/api/postboard/:sessionId/posts/:postId/react']
  assert.ok(handler)

  const missingStudent = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'peer-approved' },
    body: { reactionId: '👍' },
  }, missingStudent)
  assert.equal(missingStudent.statusCode, 400)

  const invalidReaction = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'peer-approved' },
    body: { studentId: 'student-1', reactionId: 'not-real' },
  }, invalidReaction)
  assert.equal(invalidReaction.statusCode, 400)

  const selfReaction = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'own-approved' },
    body: { studentId: 'student-1', reactionId: '👍' },
  }, selfReaction)
  assert.equal(selfReaction.statusCode, 403)

  const pendingReaction = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'pending-peer' },
    body: { studentId: 'student-1', reactionId: '👍' },
  }, pendingReaction)
  assert.equal(pendingReaction.statusCode, 403)

  const hiddenReaction = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'hidden-peer' },
    body: { studentId: 'student-1', reactionId: '👍' },
  }, hiddenReaction)
  assert.equal(hiddenReaction.statusCode, 403)

  type ReactResponseBody = { reactionCounts?: unknown; viewerReactions?: unknown }

  const added = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'peer-approved' },
    body: { studentId: 'student-1', reactionId: '👍' },
  }, added)
  assert.equal(added.statusCode, 200)
  assert.deepEqual((added.body as ReactResponseBody).reactionCounts, { 'peer-approved': { '👍': 1 } })
  assert.deepEqual((added.body as ReactResponseBody).viewerReactions, { 'peer-approved': '👍' })

  const changed = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'peer-approved' },
    body: { studentId: 'student-1', reactionId: '❤️' },
  }, changed)
  assert.deepEqual((changed.body as ReactResponseBody).reactionCounts, { 'peer-approved': { '❤️': 1 } })
  assert.deepEqual((changed.body as ReactResponseBody).viewerReactions, { 'peer-approved': '❤️' })

  const removed = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'peer-approved' },
    body: { studentId: 'student-1', reactionId: null },
  }, removed)
  assert.deepEqual((removed.body as ReactResponseBody).reactionCounts, {})
  assert.deepEqual((removed.body as ReactResponseBody).viewerReactions, {})

  const instructorReaction = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'hidden-peer' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { reactionId: '🔥' },
  }, instructorReaction)
  assert.deepEqual((instructorReaction.body as ReactResponseBody).reactionCounts, {
    'hidden-peer': { '🔥': 2 },
    'own-approved': { '👍': 1 },
  })
  assert.deepEqual((instructorReaction.body as ReactResponseBody).viewerReactions, { 'hidden-peer': '🔥' })
  assert.equal(messages.length, 4)
})

void test('flag route toggles a single instructor flag state', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
    posts: [
      {
        id: 'post-1',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Needs follow up',
        styleId: 'lemon',
        createdAt: 100,
        updatedAt: 100,
        status: 'approved',
        approvedAt: 100,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: 0,
      },
    ],
  })
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/:sessionId/posts/:postId/flag']
  assert.ok(handler)

  const flagResponse = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { flagged: true },
  }, flagResponse)
  assert.equal(flagResponse.statusCode, 200)
  assert.equal(((flagResponse.body as { flags?: PostboardSessionData['flags'] }).flags?.['post-1'] ?? []).length, 1)

  const secondFlagResponse = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { flagged: true },
  }, secondFlagResponse)
  assert.equal(((secondFlagResponse.body as { flags?: PostboardSessionData['flags'] }).flags?.['post-1'] ?? []).length, 1)

  const unflagResponse = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
    body: { flagged: false },
  }, unflagResponse)
  assert.equal((unflagResponse.body as { flags?: PostboardSessionData['flags'] }).flags?.['post-1'], undefined)
})

void test('student delete marks an own rejected post deleted for instructor view', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    acceptedEntryParticipants: {
      'student-1': {
        participantId: 'student-1',
        displayName: 'Ada Lovelace',
        acceptedAt: 100,
      },
    },
    posts: [
      {
        id: 'post-1',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Returned note',
        styleId: 'lemon',
        createdAt: 100,
        updatedAt: 101,
        status: 'rejected',
        approvedAt: null,
        rejectedAt: 101,
        deletedAt: null,
        hiddenAt: null,
        order: 0,
      },
    ],
  })
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/:sessionId/posts/:postId/delete']
  assert.ok(handler)

  const response = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'post-1' },
    body: { studentId: 'student-1' },
  }, response)

  assert.equal(response.statusCode, 200)
  const stored = await store.get(session.id)
  const storedData = stored?.data as PostboardSessionData | undefined
  assert.equal(storedData?.posts[0]?.status, 'deleted')
  assert.equal(typeof storedData?.posts[0]?.deletedAt, 'number')
  assert.deepEqual(buildStudentSnapshot(stored as SessionRecord & { type: 'postboard'; data: PostboardSessionData }, 'student-1').posts, [])
  assert.equal(buildInstructorSnapshot(stored as SessionRecord & { type: 'postboard'; data: PostboardSessionData }).posts[0]?.status, 'deleted')
})

void test('unreject route returns a rejected post to pending moderation', async () => {
  const app = new TestApp()
  const store = new MemoryStore()
  const session = createSession({
    posts: [
      {
        id: 'post-1',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Returned note',
        styleId: 'lemon',
        createdAt: 100,
        updatedAt: 101,
        status: 'rejected',
        approvedAt: null,
        rejectedAt: 101,
        deletedAt: null,
        hiddenAt: null,
        order: 0,
      },
    ],
  })
  await store.set(session.id, session)
  setupPostboardRoutes(app, store, createWsRouter())

  const handler = app.handlers.post['/api/postboard/:sessionId/posts/:postId/unreject']
  assert.ok(handler)

  const response = createResponse()
  await handler({
    params: { sessionId: session.id, postId: 'post-1' },
    headers: { 'x-instructor-passcode': 'teacher-pass' },
  }, response)

  assert.equal(response.statusCode, 200)
  const body = response.body as { posts?: Array<{ status?: string; rejectedAt?: number | null }> }
  assert.equal(body.posts?.[0]?.status, 'pending')
  assert.equal(body.posts?.[0]?.rejectedAt, null)
})
