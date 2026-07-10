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
import type { PostboardSessionData } from '../shared/types.js'

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
  assert.deepEqual(snapshot.ownRejectedPosts, [])
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
})

void test('flag route toggles a single instructor flag state', async () => {
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
