import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import { registerPersistentSessionRoutes } from './routes/persistentSessionRoutes.js'
import {
  findHashBySessionId,
  findIndexedHashBySessionId,
  initializePersistentStorage,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  startPersistentSession,
  resetPersistentSession,
  cleanupPersistentSession,
  updatePersistentSessionUrlState,
} from './core/persistentSessions.js'
import { buildPersistentLinkUrlQuery } from './core/persistentLinkUrlState.js'
import { getActivityCapabilityCookieName, issueActivityCapability } from './core/activityCapabilities.js'

function createFakePersistentValkeyClient(): {
  store: Map<string, string>
  on: () => void
  subscribe: () => Promise<number>
  publish: () => Promise<number>
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<string>
  del: (key: string) => Promise<number>
  eval: () => Promise<number>
  scan: (cursor: string, ...args: Array<string | number>) => Promise<[string, string[]]>
  quit: () => Promise<string>
  ping: () => Promise<string>
  dbsize: () => Promise<number>
  pttl: () => Promise<number>
  call: () => Promise<string>
} {
  const store = new Map<string, string>()

  return {
    store,
    on() {},
    subscribe: async () => 1,
    publish: async () => 0,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    },
    del: async (key: string) => {
      const existed = store.delete(key)
      return existed ? 1 : 0
    },
    eval: async () => 0,
    scan: async (_cursor: string, ...args: Array<string | number>) => {
      const matchIndex = args.findIndex((arg) => arg === 'MATCH')
      const pattern = matchIndex >= 0 ? String(args[matchIndex + 1] ?? '*') : '*'
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
      const keys = Array.from(store.keys()).filter((key) => key.startsWith(prefix))
      return ['0', keys]
    },
    quit: async () => 'OK',
    ping: async () => 'PONG',
    dbsize: async () => store.size,
    pttl: async () => -1,
    call: async () => 'OK',
  }
}

interface MockRequest {
  params: Record<string, string>
  query: Record<string, unknown>
  cookies: Record<string, string>
  body: Record<string, unknown>
  ip?: string
  socket?: {
    remoteAddress?: string
  }
  protocol: string
  get(name: string): string | undefined
}

interface MockResponse {
  statusCode: number
  cookies: Map<string, { value: string; options: Record<string, unknown> }>
  jsonBody: Record<string, unknown> | null
  headers: Record<string, string>
  status(code: number): MockResponse
  set(field: string, value: string): MockResponse
  json(payload: Record<string, unknown>): Record<string, unknown>
  cookie(name: string, value: string, options: Record<string, unknown>): void
}

type RouteHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

function createMockApp(): {
  use: () => void
  get: (path: string, handler: RouteHandler) => void
  post: (path: string, handler: RouteHandler) => void
  routes: { get: Map<string, RouteHandler>; post: Map<string, RouteHandler> }
} {
  const routes = { get: new Map<string, RouteHandler>(), post: new Map<string, RouteHandler>() }
  return {
    use() {},
    get(path: string, handler: RouteHandler) {
      routes.get.set(path, handler)
    },
    post(path: string, handler: RouteHandler) {
      routes.post.set(path, handler)
    },
    routes,
  }
}

function createMockReq({
  params = {},
  query = {},
  cookies = {},
  body = {},
  headers = {},
  ip,
  remoteAddress,
  protocol = 'http',
}: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  cookies?: Record<string, string>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  ip?: string
  remoteAddress?: string
  protocol?: string
} = {}): MockRequest {
  return {
    params,
    query,
    cookies,
    body,
    ip,
    socket: remoteAddress ? { remoteAddress } : undefined,
    protocol,
    get(name: string) {
      const key = name.toLowerCase()
      return headers[key]
    },
  }
}

function createMockRes(): MockResponse {
  return {
    statusCode: 200,
    cookies: new Map(),
    jsonBody: null,
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    set(field: string, value: string) {
      this.headers[field.toLowerCase()] = value
      return this
    },
    json(payload: Record<string, unknown>) {
      this.jsonBody = payload
      return payload
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.set(name, { value, options })
    },
  }
}

function buildCookieValue(
  activityName: string,
  hash: string,
  teacherCode: string,
  selectedOptions?: Record<string, unknown>,
): string {
  return JSON.stringify([{ key: `${activityName}:${hash}`, teacherCode, selectedOptions }])
}

function getRoute(app: ReturnType<typeof createMockApp>, method: 'GET' | 'POST', path: string): RouteHandler {
  const store = method === 'GET' ? app.routes.get : app.routes.post
  const handler = store.get(path)
  if (!handler) throw new Error(`Route ${method} ${path} not registered`)
  return handler
}

void test('persistent session route keeps valid backing session', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'secret-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.equal(res.jsonBody?.entryPolicy, 'instructor-required')
  assert.equal(res.jsonBody?.isStarted, true)
  assert.equal(res.jsonBody?.sessionId, 'live-session')

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'instructor-required')
})

void test('session teacher authenticate does not issue a capability cookie when persistence fails', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async () => { throw new Error('simulated session-store write failure') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected manager capability persistence failure during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'manager capability unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate fails closed when the store cannot persist a capability', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  // No `set`: the store cannot persist a manager capability at all. The
  // teacher-auth response is what establishes manager authority, so this must
  // fail closed rather than report success without a usable cookie.
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected fail-closed manager capability response: the injected store has no set().')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'manager capability unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate persists the capability through updateAtomic', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const current = sessionMap.get(id) as Record<string, unknown> | undefined
      if (current == null) return null
      const draft = structuredClone(current)
      const mutated = mutate(draft)
      const committed = { ...mutated, mutationRevision: ((current.mutationRevision as number | undefined) ?? 0) + 1 }
      sessionMap.set(id, structuredClone(committed))
      return structuredClone(committed)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, mutationRevision: 1,
    data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(setCalls, 0, 'the atomic branch does not fall back to a whole-session set()')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), true)
  const persisted = sessionMap.get('live-session') as { mutationRevision?: number; data?: { activityCapabilities?: Record<string, unknown> } }
  assert.ok(persisted.data?.activityCapabilities, 'capability persisted via updateAtomic')
  assert.equal((persisted.mutationRevision ?? 0) > 1, true, 'the atomic write advanced the revision')
})

void test('session teacher authenticate does not issue a cookie when an updateAtomic retry runs against a reused id', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
    // Simulate a CAS conflict + concurrent id reuse: the callback runs once
    // against the authorized record, then again against an algorithm-demo
    // replacement. The stale capabilityToken from attempt 1 must not leak.
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const first = sessionMap.get(id) as Record<string, unknown> | undefined
      if (first == null) return null
      mutate(structuredClone(first))
      const replacement = { id, type: 'algorithm-demo', created: Date.now(), data: {} }
      sessionMap.set(id, replacement)
      return mutate(structuredClone(replacement))
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected teacher-authenticate 404 + incarnation-mismatch log: the id was reused for a different activity during the updateAtomic retry.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 404)
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
  const replacement = sessionMap.get('live-session') as { data?: { activityCapabilities?: unknown } }
  assert.equal(replacement.data?.activityCapabilities, undefined, 'the algorithm-demo replacement gets no manager capability')
})

void test('session teacher authenticate does not issue a cookie when the id is recreated as the same activity mid-flush', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
    // The pre-mutation strict read still sees the authorized incarnation
    // (created: 1000); the CAS then runs against a same-type replacement that
    // carries a fresh `created`, so the incarnation guard - not just the type
    // check - must abandon the write. A faithful store commits nothing when the
    // callback throws (no revision bump, no TTL reset).
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const replacement = { id, type: 'syncdeck', created: 5000, mutationRevision: 7, data: {} }
      sessionMap.set(id, replacement)
      const mutated = mutate(structuredClone(replacement))
      const committed = { ...mutated, mutationRevision: 8 }
      sessionMap.set(id, structuredClone(committed))
      return structuredClone(committed)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, created: 1000, mutationRevision: 1,
    data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected teacher-authenticate 404: the id was recreated as a fresh same-type incarnation mid-flush.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 404)
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
  const replacement = sessionMap.get('live-session') as { mutationRevision?: number; data?: { activityCapabilities?: unknown } }
  assert.equal(replacement.data?.activityCapabilities, undefined, 'the recreated same-type incarnation gets no manager capability')
  assert.equal(replacement.mutationRevision, 7, 'the mismatched CAS is abandoned, not committed as a no-op revision bump')
})

void test('session teacher authenticate returns 404 when updateAtomic cannot commit the capability', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
    updateAtomic: async () => null,
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected teacher-authenticate 404: updateAtomic returns null (session gone during the retry).')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 404)
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('persistent manager capability recovery issues a manager cookie for an authenticated live permalink', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { success: true, persistentRecoveryAvailable: true })
  assert.equal(Array.from(res.cookies.keys()).filter((name) => name.startsWith('activebits_cap_manager_')).length, 1)

  // The mutation must survive the store boundary: a no-op set would pass the
  // assertions above but leave no capability record on the persisted session.
  const persisted = await sessions.get('live-session') as { data?: { activityCapabilities?: Record<string, unknown> } } | null
  assert.ok(persisted?.data?.activityCapabilities, 'capability is persisted on the live session record')
  assert.equal(Object.keys(persisted!.data!.activityCapabilities!).length, 1)
})

void test('persistent manager capability recovery rate-limits repeated teacher-code attempts', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const callWithWrongCode = async () => {
    const res = createMockRes()
    await handler(createMockReq({
      params: { sessionId: 'live-session' },
      cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
    }), res)
    return res
  }

  // `persistent_sessions` is client-supplied and forgeable, so this route must
  // cap teacher-code attempts by IP+hash just like POST /teacher-authenticate.
  console.info('[TEST] Expected repeated invalid persistent teacher-code attempts against persistent-manager-capability.')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await callWithWrongCode()
    assert.equal(res.statusCode, 403, `attempt ${attempt} is a normal auth failure`)
  }
  const blocked = await callWithWrongCode()
  assert.equal(blocked.statusCode, 429)
  assert.deepEqual(blocked.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
  // The client treats 429 as "wait and retry", not a definitive denial.
  assert.equal(blocked.headers['retry-after'], '60')
  assert.equal(
    Array.from(blocked.cookies.keys()).filter((name) => name.startsWith('activebits_cap_manager_')).length,
    0,
    'no capability cookie is issued for a rate-limited caller',
  )
})

void test('persistent manager capability recovery returns a retryable 500 when the rate limiter backend fails', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // Fail the rate-limit INCR script only; setup above already ran.
  valkeyClient.eval = async () => { throw new Error('[TEST] rate limiter outage') }

  const res = createMockRes()
  console.info('[TEST] Expected rate-limiter backend failure during persistent manager capability recovery.')
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), res)

  // Not "allowed" via a fail-open 0: a limiter outage must be a retryable 500,
  // not an open brute-force window.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Manager capability is temporarily unavailable' })
})

void test('persistent manager capability recovery does not charge attempts to a caller with no teacher-code candidate', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // An unrelated caller who only knows the live session id (no matching
  // `persistent_sessions` entry) must not be able to drain the shared IP+hash
  // attempt bucket and lock the real teacher out on a shared address.
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const res = createMockRes()
    await handler(createMockReq({ params: { sessionId: 'live-session' }, cookies: {} }), res)
    assert.equal(res.statusCode, 403, `cookieless attempt ${attempt} is a plain 403, never 429`)
  }

  // The teacher's own bucket is untouched: a full run of wrong-code attempts is
  // still needed before the 429.
  console.info('[TEST] Expected repeated invalid persistent teacher-code attempts against persistent-manager-capability.')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = createMockRes()
    await handler(createMockReq({
      params: { sessionId: 'live-session' },
      cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
    }), res)
    assert.equal(res.statusCode, 403, `wrong-code attempt ${attempt} is a normal auth failure`)
  }
  const blocked = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), blocked)
  assert.equal(blocked.statusCode, 429)
})

void test('persistent manager capability recovery issues the capability onto the latest session record', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let getCalls = 0
  const sessions = {
    get: async (id: string) => {
      getCalls += 1
      // Simulate a concurrent activity update that lands after the handler's
      // initial read but before it persists the capability: the second read
      // (the handler's re-read) sees a newer field the first read did not.
      if (id === 'live-session' && getCalls === 2) {
        const current = sessionMap.get(id) as { data: Record<string, unknown> }
        sessionMap.set(id, { ...current, data: { ...current.data, concurrentMarker: 'landed-mid-flight' } })
      }
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 200)
  const persisted = await sessions.get('live-session') as
    { data?: { activityCapabilities?: Record<string, unknown>; concurrentMarker?: string } } | null
  assert.ok(persisted?.data?.activityCapabilities, 'capability is persisted')
  assert.equal(persisted?.data?.concurrentMarker, 'landed-mid-flight', 'the concurrent update is not clobbered by a stale snapshot write')
})

void test('persistent manager capability recovery persists the capability through updateAtomic', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const current = sessionMap.get(id) as Record<string, unknown> | undefined
      if (current == null) return null
      const draft = structuredClone(current)
      const mutated = mutate(draft)
      const committed = { ...mutated, mutationRevision: ((current.mutationRevision as number | undefined) ?? 0) + 1 }
      sessionMap.set(id, structuredClone(committed))
      return structuredClone(committed)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, mutationRevision: 2, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(setCalls, 0, 'the atomic branch does not fall back to a whole-session set()')
  const persisted = await sessions.get('live-session') as
    { mutationRevision?: number; data?: { activityCapabilities?: Record<string, unknown> } } | null
  assert.ok(persisted?.data?.activityCapabilities, 'capability persisted via updateAtomic')
  assert.equal((persisted?.mutationRevision ?? 0) > 2, true, 'the atomic write advanced the revision')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), true)
})

void test('persistent manager capability recovery via updateAtomic does not issue when the activity type changes during the retry', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let getStrictCalls = 0
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      getStrictCalls += 1
      // The pre-mutation strict read still sees the authorized activity; the id
      // is then reused for a different activity before updateAtomic reads it.
      const session = sessionMap.get(id)
      if (id === 'live-session' && getStrictCalls >= 1) {
        sessionMap.set(id, { id: 'live-session', type: 'algorithm-demo', data: {} })
      }
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const current = sessionMap.get(id) as Record<string, unknown> | undefined
      if (current == null) return null
      const draft = structuredClone(current)
      const mutated = mutate(draft)
      sessionMap.set(id, structuredClone(mutated))
      return structuredClone(mutated)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected persistent-manager-capability 404 + incarnation-mismatch log: the id was reused for a different activity type before the CAS write.')
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'Active session not found' })
  assert.equal(setCalls, 0, 'no capability written into the replacement session')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
  const replacement = sessionMap.get('live-session') as { data?: { activityCapabilities?: unknown } }
  assert.equal(replacement.data?.activityCapabilities, undefined, 'the algorithm-demo replacement gets no manager capability')
})

void test('persistent manager capability recovery via updateAtomic does not issue when the same-type id is recreated during the retry', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
    // Both strict reads still see created: 1000; the CAS draft is a same-type
    // replacement with a fresh created, so the incarnation guard abandons it.
    updateAtomic: async (id: string, mutate: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      const replacement = { id, type: 'java-format-practice', created: 5000, mutationRevision: 9, data: { students: [] } }
      sessionMap.set(id, replacement)
      const mutated = mutate(structuredClone(replacement))
      sessionMap.set(id, structuredClone(mutated))
      return structuredClone(mutated)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, created: 1000, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected persistent-manager-capability 404: the id was recreated as a fresh same-type incarnation during the CAS retry.')
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.equal(setCalls, 0, 'no capability written into the recreated incarnation')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
  const replacement = sessionMap.get('live-session') as { mutationRevision?: number; data?: { activityCapabilities?: unknown } }
  assert.equal(replacement.data?.activityCapabilities, undefined, 'the recreated same-type incarnation gets no manager capability')
  assert.equal(replacement.mutationRevision, 9, 'the mismatched CAS is abandoned, not committed as a no-op revision bump')
})

void test('persistent manager capability recovery does not issue into a session whose id was reused for another activity mid-request', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let getCalls = 0
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      getCalls += 1
      // The persistent authorization is established on the first read
      // (java-format-practice). By the handler's re-read the id has been reused
      // for a different activity - issuing a manager capability here would grant
      // authority over the replacement session.
      if (id === 'live-session' && getCalls >= 2) {
        return structuredClone({ id: 'live-session', type: 'algorithm-demo', data: {} })
      }
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'Active session not found' })
  assert.equal(setCalls, 0, 'no capability is written into the replacement session')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('persistent manager capability recovery fast-paths an already-authorized caller without re-issuing', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  // A live session that carries a valid manager capability already (as /create
  // would leave it). No persistent session is registered and no
  // persistent_sessions cookie is sent, so recovery is not persistently backed.
  const liveSession = { id: 'live-session', type: 'java-format-practice', data: { students: [] } }
  const capability = issueActivityCapability(liveSession, 'manager')
  sessionMap.set('live-session', liveSession)

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: { [getActivityCapabilityCookieName('manager', 'live-session')]: capability.token },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { success: true, alreadyAuthorized: true, persistentRecoveryAvailable: false })
  // Fast path: no re-issue, no session write, no capability cookie set.
  assert.equal(setCalls, 0)
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('persistent manager capability recovery fast path reports persistent recoverability when a teacher cookie backs it', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  // The permalink flow: teacher-authenticate already issued the manager
  // capability, so this call hits the fast path - but it must still report
  // that a later capability loss is recoverable by reload.
  const liveSession = { id: 'live-session', type: activityName, data: { students: [] } }
  const capability = issueActivityCapability(liveSession, 'manager')
  sessionMap.set('live-session', liveSession)
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: {
      [getActivityCapabilityCookieName('manager', 'live-session')]: capability.token,
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode),
    },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { success: true, alreadyAuthorized: true, persistentRecoveryAvailable: true })
  assert.equal(setCalls, 0, 'fast path still does not re-issue')
})

void test('persistent manager capability recovery returns a retryable 500 when the reverse-index read fails', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index read failed')
    }
    return originalGet(key)
  }
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()

  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')
  t.after(() => { initializePersistentStorage(null) })

  sessionMap.set('live-session', { id: 'live-session', type: 'java-format-practice', data: { students: [] } })

  const res = createMockRes()
  console.info('[TEST] Expected reverse-index read failure during persistent manager capability recovery.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, cookies: {} }), res)

  // Not 404: a transient outage must surface as retryable, so the Java manager
  // uses its 5xx retry path instead of latching auth loss.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Manager capability is temporarily unavailable' })
})

void test('persistent manager capability recovery returns a retryable 500 when the record read fails for an uncredentialed caller', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // The reverse index resolves, but the persistent record read then rejects.
  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent:')) {
      throw new Error('[TEST] persistent record read failed')
    }
    return originalGet(key)
  }

  const sessionMap = new Map<string, unknown>()
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const res = createMockRes()
  console.info('[TEST] Expected persistent record read failure during persistent manager capability recovery for an uncredentialed caller.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, cookies: {} }), res)

  // A caller without a capability cookie depends on this lookup to authorize, so
  // a store outage must be retryable (500), never a terminal 404.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Manager capability is temporarily unavailable' })
})

void test('persistent manager capability recovery returns a retryable 500 when the live-session read rejects', async (t) => {
  initializePersistentStorage(null)
  t.after(() => { initializePersistentStorage(null) })
  const sessions = {
    get: async () => { throw new Error('[TEST] session store read (non-strict) unavailable') },
    getStrict: async () => { throw new Error('[TEST] session store read unavailable') },
    set: async () => {},
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const res = createMockRes()
  console.info('[TEST] Expected live-session strict read failure during persistent manager capability recovery.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, cookies: {} }), res)

  // ValkeySessionStore.get swallows read failures to null (-> false 404). The
  // strict read must instead reject into the outer catch -> retryable 500.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Manager capability is temporarily unavailable' })
})

void test('persistent manager capability recovery fast path survives a persistent-store outage for an already-authorized caller', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent:') || key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] persistent-store outage')
    }
    return originalGet(key)
  }

  const liveSession = { id: 'live-session', type: activityName, data: { students: [] } }
  const capability = issueActivityCapability(liveSession, 'manager')
  const sessionMap = new Map<string, unknown>([['live-session', liveSession]])
  let setCalls = 0
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { setCalls += 1; sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/persistent-manager-capability')

  const res = createMockRes()
  console.info('[TEST] Expected persistent-store outage during an already-authorized persistent manager capability fast path; it must degrade, not 500.')
  await handler(createMockReq({
    params: { sessionId: 'live-session' },
    cookies: {
      [getActivityCapabilityCookieName('manager', 'live-session')]: capability.token,
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode),
    },
  }), res)

  // The caller already holds a valid capability, so a store blip must not fail
  // the request; recovery just degrades to "not known recoverable".
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { success: true, alreadyAuthorized: true, persistentRecoveryAvailable: false })
  assert.equal(setCalls, 0, 'fast path still does not re-issue')
})

void test('persistent session route resets when backing session missing', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'missing-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'ghost-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.jsonBody?.isStarted, false)
  assert.equal(res.jsonBody?.sessionId, null)

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)
})

void test('persistent session route allows recreation after reset', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'restart-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'expired-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const cookieValue = buildCookieValue(activityName, hash, teacherCode)
  const firstReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const firstRes = createMockRes()
  await handler(firstReq, firstRes)
  assert.equal(firstRes.jsonBody?.isStarted, false)

  sessionMap.set('new-session', { id: 'new-session' })
  await startPersistentSession(hash, 'new-session', { id: 'teacher-ws-2', readyState: 1, send() {} })

  const secondReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const secondRes = createMockRes()
  await handler(secondReq, secondRes)
  assert.equal(secondRes.jsonBody?.isStarted, true)
  assert.equal(secondRes.jsonBody?.sessionId, 'new-session')
})

void test('persistent session create rejects solo-capable entry policies for non-solo activities', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessions = { get: async () => null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/persistent-session/create')

  const req = createMockReq({
    body: {
      activityName: 'raffle',
      teacherCode: 'teacher-secret',
      entryPolicy: 'solo-only',
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'This activity does not support solo entry links' })
})

void test('persistent session update rejects solo-capable entry policies for non-solo activities', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessions = { get: async () => null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/persistent-session/update')

  const req = createMockReq({
    body: {
      activityName: 'raffle',
      hash: 'deadbeef',
      entryPolicy: 'solo-allowed',
      selectedOptions: {},
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'This activity does not support solo entry links' })
})

void test('persistent session update returns a controlled 500 when the reverse-index write fails for an active link', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/persistent-session/update')

  const activityName = 'java-format-practice'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', { id: 'live-session', type: activityName, data: { students: [] } })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const originalSet = valkeyClient.set
  valkeyClient.set = async (key: string, ...rest: Array<string | number>) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index write failed')
    }
    return originalSet(key, rest[0] as string)
  }

  const res = createMockRes()
  console.info('[TEST] Expected reverse-index write failure while updating an already-started persistent link.')
  await handler(createMockReq({
    body: { activityName, hash, entryPolicy: 'instructor-required' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Persistent link storage is temporarily unavailable' })
  assert.equal(res.cookies.has('persistent_sessions'), false, 'no success cookie is written on a persist failure')
})

void test('persistent session entry route returns shared entry status for started live sessions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'entry-status-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: true,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 1,
    resolvedRole: 'teacher',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route keeps started live student entry in student role without a teacher cookie', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'student-live-entry'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route returns wait status for instructor-required student entry before startup', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'student-wait-status'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'wait',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route passes straight through for started live activities without waiting-room fields', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'raffle'
  const teacherCode = 'live-pass-through'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'pass-through',
  })
})

void test('persistent session entry route resets stale backing sessions before resolving entry status', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'stale-entry-status'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'ghost-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'wait',
    presentationMode: 'render-ui',
  })

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)
})

void test('persistent session entry route keeps solo-only links in solo status even with teacher cookie', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  // A permalink-solo-capable activity (java-format temporarily sets
  // supportsPermalink: false during the Slice A auth migration — see #351).
  const activityName = 'java-string-practice'
  const teacherCode = 'solo-only-entry'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const req = createMockReq({
    params: { hash },
    query: { activityName, entryPolicy: query.get('entryPolicy') ?? '', urlHash: query.get('urlHash') ?? '' },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'solo-only',
    hasTeacherCookie: true,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'continue-solo',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route returns solo-unavailable for non-solo activities on solo-only links', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'raffle'
  const teacherCode = 'solo-unavailable-entry'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const req = createMockReq({
    params: { hash },
    query: { activityName, entryPolicy: query.get('entryPolicy') ?? '', urlHash: query.get('urlHash') ?? '' },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'solo-only',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'solo-unavailable',
    presentationMode: 'pass-through',
  })
})

void test('persistent session entry route rejects requests missing activityName', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const res = createMockRes()
  await handler(createMockReq({ params: { hash: 'abc123' } }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'Missing activityName parameter' })
})

void test('persistent session metadata route reports corrupted cookies while preserving student entry state', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'java-string-practice'
  const teacherCode = 'corrupted-cookie'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  console.log('[TEST] Expected corrupted-cookie parse error output follows for persistent session metadata route coverage.')

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: '{bad-json' },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    cookieCorrupted: true,
    isStarted: false,
    sessionId: null,
    queryParams: {},
  })
})

void test('persistent session metadata route ignores invalid remembered teacher cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    cookieCorrupted: false,
    isStarted: false,
    sessionId: null,
    queryParams: {},
  })
})

void test('teacher-code route rejects requests missing activityName', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const res = createMockRes()
  await handler(createMockReq({ params: { hash: 'abc123' } }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'Missing activityName parameter' })
})

void test('persistent session entry route ignores invalid remembered teacher cookies for role resolution', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('teacher-code route returns 404 when the permalink has no remembered teacher code', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash: 'hash-1' },
    query: { activityName: 'java-string-practice' },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'No teacher code found' })
})

void test('teacher-code route rejects remembered codes that do not validate for the permalink hash', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code'),
    },
  }), res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.jsonBody, { error: 'forbidden' })
})

void test('teacher-code route returns the remembered code when it still validates for the permalink hash', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const activityName = 'java-string-practice'
  const teacherCode = 'valid-teacher-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode),
    },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { teacherCode })
})

void test('persistent entry participant routes store and consume values by token', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const storeRes = createMockRes()
  await storeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: {
      values: {
        displayName: 'Ada',
        ignored: () => 'x',
      },
    },
  }), storeRes)

  assert.equal(storeRes.statusCode, 200)
  assert.equal(storeRes.headers['cache-control'], 'no-store')
  const token = typeof storeRes.jsonBody?.entryParticipantToken === 'string' ? storeRes.jsonBody.entryParticipantToken : null
  assert.equal(typeof token, 'string')
  assert.equal(typeof (storeRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId, 'string')

  const consumeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant/consume')
  const consumeRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: String(token) },
  }), consumeRes)

  assert.equal(consumeRes.statusCode, 200)
  assert.equal(consumeRes.headers['cache-control'], 'no-store')
  assert.deepEqual(consumeRes.jsonBody, {
    values: {
      displayName: 'Ada',
      participantId: (storeRes.jsonBody?.values as Record<string, unknown>).participantId,
    },
  })

  const missingRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: String(token) },
  }), missingRes)

  assert.equal(missingRes.statusCode, 404)
  assert.deepEqual(missingRes.jsonBody, { error: 'entry participant not found' })
})

void test('persistent entry participant store route rejects invalid persistent sessions', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const res = createMockRes()
  await storeHandler(createMockReq({
    params: { hash: 'missing-hash' },
    query: { activityName: 'java-string-practice' },
    body: {
      values: {
        displayName: 'Ada',
      },
    },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid persistent session' })
})

void test('persistent entry participant store route rejects oversized payloads', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant-oversized'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const res = createMockRes()
  await storeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: {
      values: {
        displayName: 'x'.repeat(9000),
      },
    },
  }), res)

  assert.equal(res.statusCode, 413)
  assert.deepEqual(res.jsonBody, { error: 'entry participant payload too large' })
})

void test('persistent entry participant store route prunes oldest tokens when limit is exceeded', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant-prune'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const consumeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant/consume')
  const tokens: string[] = []

  for (let index = 0; index < 101; index += 1) {
    const storeRes = createMockRes()
    await storeHandler(createMockReq({
      params: { hash },
      query: { activityName },
      body: {
        values: {
          displayName: `Student-${index}`,
        },
      },
    }), storeRes)

    assert.equal(storeRes.statusCode, 200)
    const token = storeRes.jsonBody?.entryParticipantToken
    assert.equal(typeof token, 'string')
    tokens.push(String(token))
  }

  const oldestRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: tokens[0] as string },
  }), oldestRes)
  assert.equal(oldestRes.statusCode, 404)
  assert.deepEqual(oldestRes.jsonBody, { error: 'entry participant not found' })

  const newestRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: tokens[100] as string },
  }), newestRes)
  assert.equal(newestRes.statusCode, 200)
  assert.equal(
    typeof (newestRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId,
    'string',
  )
})

void test('teacher lifecycle clears session on explicit end', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    delete: async (id: string) => {
      sessionMap.delete(id)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'teacher-end'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  const cookieValue = buildCookieValue(activityName, hash, teacherCode)
  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('lifecycle-session', { id: 'lifecycle-session' })
  await startPersistentSession(hash, 'lifecycle-session', { id: 'teacher-ws', readyState: 1, send() {} })

  await resetPersistentSession(hash)
  await sessions.delete('lifecycle-session')
  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const res = createMockRes()
  await getRoute(app, 'GET', '/api/persistent-session/:hash')(req, res)
  assert.equal(res.jsonBody?.isStarted, false)
})

void test('session id reverse lookup tracks start, reset, and restart lifecycle', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'gallery-walk'
  const teacherCode = 'reverse-lookup'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  assert.equal(await findHashBySessionId('first-session'), null)

  await startPersistentSession(hash, 'first-session', { id: 'teacher-ws', readyState: 1, send() {} })
  assert.equal(await findHashBySessionId('first-session'), hash)

  await resetPersistentSession(hash)
  assert.equal(await findHashBySessionId('first-session'), null)

  await startPersistentSession(hash, 'second-session', { id: 'teacher-ws-2', readyState: 1, send() {} })
  assert.equal(await findHashBySessionId('second-session'), hash)
  assert.equal(await findHashBySessionId('first-session'), null)
})

void test('session id reverse lookup survives started-session metadata updates', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'syncdeck'
  const teacherCode = 'metadata-refresh'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  await updatePersistentSessionUrlState(hash, {
    entryPolicy: 'solo-allowed',
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
  })

  assert.equal(await findHashBySessionId('live-session'), hash)
})

void test('session id reverse lookup backfills missing reverse index entries for existing started sessions', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)

  const activityName = 'syncdeck'
  const teacherCode = 'backfill-reverse-index'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'legacy-session', { id: 'teacher-ws', readyState: 1, send() {} })
  await valkeyClient.del('persistent-session-by-session:legacy-session')

  assert.equal(await findHashBySessionId('legacy-session'), hash)
  assert.equal(await findHashBySessionId('legacy-session'), hash)
})

void test('starting a persistent session fails loudly when the reverse-index write fails', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'syncdeck'
  const teacherCode = 'index-write-fail'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')

  const originalSet = valkeyClient.set
  valkeyClient.set = async (key: string, value: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index write failed')
    }
    return originalSet(key, value)
  }

  console.info('[TEST] Expected reverse-index write failure while starting a persistent session.')
  // Manager recovery is index-only, so a record persisted without its reverse
  // index is silently unrecoverable. The write must reject rather than report a
  // "successful" persistent session that recovery classifies as missing.
  await assert.rejects(
    startPersistentSession(hash, 'index-write-fail-session', { id: 'teacher-ws', readyState: 1, send() {} }),
    /reverse-index write failed/,
  )
})

void test('session id reverse lookup ignores stale reverse index entries and repairs them', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)

  const activityName = 'syncdeck'
  const { hash: correctHash, hashedTeacherCode: correctTeacherCode } = generatePersistentHash(activityName, 'correct-code')
  const { hash: staleHash, hashedTeacherCode: staleTeacherCode } = generatePersistentHash(activityName, 'stale-code')
  t.after(async () => cleanupPersistentSession(correctHash))
  t.after(async () => cleanupPersistentSession(staleHash))

  await getOrCreateActivePersistentSession(activityName, correctHash, correctTeacherCode, 'solo-allowed')
  await startPersistentSession(correctHash, 'shared-session', { id: 'teacher-ws', readyState: 1, send() {} })

  await getOrCreateActivePersistentSession(activityName, staleHash, staleTeacherCode, 'solo-allowed')
  await startPersistentSession(staleHash, 'other-session', { id: 'teacher-ws-2', readyState: 1, send() {} })

  await valkeyClient.set('persistent-session-by-session:shared-session', staleHash)

  assert.equal(await findHashBySessionId('shared-session'), correctHash)
  assert.equal(await valkeyClient.get('persistent-session-by-session:shared-session'), correctHash)
})

void test('indexed-only session id reverse lookup never scans the persistent-session keyspace', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  let persistentScanCount = 0
  const originalScan = valkeyClient.scan
  valkeyClient.scan = async (cursor: string, ...args: Array<string | number>) => {
    const matchIndex = args.findIndex((arg) => arg === 'MATCH')
    const pattern = matchIndex >= 0 ? String(args[matchIndex + 1] ?? '') : ''
    if (pattern.startsWith('persistent:')) persistentScanCount += 1
    return originalScan(cursor, ...args)
  }
  initializePersistentStorage(valkeyClient as never)

  const activityName = 'syncdeck'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, 'indexed-only-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // Live persistent session: resolved straight from the reverse index.
  assert.equal(await findIndexedHashBySessionId('live-session'), hash)
  // No reverse-index entry (every temporary session): null without a scan.
  assert.equal(await findIndexedHashBySessionId('temp-session'), null)
  // Stale/mismatched index entry: dropped, still no scan.
  await valkeyClient.set('persistent-session-by-session:ghost-session', 'not-a-real-hash')
  assert.equal(await findIndexedHashBySessionId('ghost-session'), null)
  assert.equal(await valkeyClient.get('persistent-session-by-session:ghost-session'), null)

  assert.equal(persistentScanCount, 0, 'index-only lookup never enumerates the persistent-session keyspace')

  // Contrast: findHashBySessionId still uses the getAllHashes() scan fallback
  // for an id with no reverse-index entry.
  await findHashBySessionId('temp-session')
  assert.ok(persistentScanCount > 0, 'findHashBySessionId still falls back to a full scan')
})

void test('indexed-only session id reverse lookup rejects a reverse-index read failure instead of returning null', async () => {
  const valkeyClient = createFakePersistentValkeyClient()
  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index read failed')
    }
    return originalGet(key)
  }
  initializePersistentStorage(valkeyClient as never)

  // A storage failure must not be indistinguishable from "no such session":
  // the recovery routes wrap this and turn a rejection into a retryable 500.
  await assert.rejects(findIndexedHashBySessionId('some-session'), /reverse-index read failed/)
  // findHashBySessionId keeps its swallow-to-null behaviour for its other
  // callers that tolerate it.
  assert.equal(await findHashBySessionId('some-session'), null)
})

void test('indexed-only session id reverse lookup keeps the reverse index when the record read fails', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'syncdeck'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, 'record-read-fail-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'record-fail-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent:')) {
      throw new Error('[TEST] persistent record read failed')
    }
    return originalGet(key)
  }

  console.info('[TEST] Expected persistent record read failure while validating an indexed reverse-lookup hash.')
  // A transient failure validating the indexed hash must propagate (the
  // recovery routes turn it into a retryable 500), not fall through to the
  // stale-index cleanup that would delete a still-valid reverse index.
  await assert.rejects(findIndexedHashBySessionId('record-fail-session'), /persistent record read failed/)

  valkeyClient.get = originalGet
  assert.equal(
    await valkeyClient.get('persistent-session-by-session:record-fail-session'),
    hash,
    'a failed record read must not delete the reverse index',
  )
})

void test('authenticate persists selectedOptions from request body when cookie entry is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-teacher'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsed.find((candidate) => candidate.key === `${activityName}:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    algorithm: 'merge-sort',
  })

  const stored = await getPersistentSession(hash)
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('authenticate preserves existing selectedOptions from cookie over request body', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-teacher-preserve'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode, {
        algorithm: 'binary-search',
      }),
    },
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsed.find((candidate) => candidate.key === `${activityName}:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    algorithm: 'binary-search',
  })
})

void test('authenticate ignores selectedOptions from invalid remembered teacher cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-teacher-invalid-cookie'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code', {
        algorithm: 'selection-sort',
      }),
    },
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsed.find((candidate) => candidate.key === `${activityName}:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('authenticate validates activity before canonicalizing selectedOptions', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const body: Record<string, unknown> = {
    activityName: 'not-a-real-activity',
    hash: 'deadbeefdeadbeefdead',
    teacherCode: 'teacher-code',
  }

  Object.defineProperty(body, 'selectedOptions', {
    enumerable: true,
    get() {
      throw new Error('[TEST] selectedOptions should not be canonicalized for invalid activity requests')
    },
  })

  const res = createMockRes()
  await handler(createMockReq({ body }), res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.jsonBody?.error, 'Invalid activity name')
})

void test('persistent session metadata route ignores unsigned query params that are not in canonical selectedOptions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'canonical-query-test',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()
  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const url = new URL(`https://bits.example${String(createRes.jsonBody?.url ?? '')}`)
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: {
      activityName: 'algorithm-demo',
      algorithm: 'merge-sort',
      entryPolicy: url.searchParams.get('entryPolicy') ?? '',
      urlHash: url.searchParams.get('urlHash') ?? '',
      utm_source: 'email',
    },
  }), res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody?.queryParams, {
    algorithm: 'merge-sort',
  })
})

void test('persistent session metadata route does not expose queryParams when urlHash is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'unsigned-query-test',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()
  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: {
      activityName: 'algorithm-demo',
      algorithm: 'merge-sort',
      entryPolicy: 'instructor-required',
      // Intentionally missing urlHash: query params must not be trusted.
      utm_source: 'email',
    },
  }), res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody?.queryParams, {})
})

void test('update preserves canonical video-sync sourceUrl across edit and list output', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'video-sync',
      teacherCode: 'video-sync-edit-code',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'video-sync',
      hash,
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /sourceUrl=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.deepEqual((sessionsList[0] as Record<string, unknown>).selectedOptions, {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })
})

void test('update preserves canonical algorithm-demo option across edit and list output', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'algorithm-edit-code',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'algorithm-demo',
      hash,
      selectedOptions: {
        algorithm: 'binary-search',
      },
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /algorithm=binary-search/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.deepEqual((sessionsList[0] as Record<string, unknown>).selectedOptions, {
    algorithm: 'binary-search',
  })

  const stored = await getPersistentSession(hash)
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'binary-search',
  })
})

void test('create persists non-default entry policy in metadata and list exposes it', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'solo-allowed-code',
      entryPolicy: 'solo-allowed',
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const activityName = 'java-string-practice'
  const hash = String(createRes.jsonBody?.hash ?? '')
  const url = String(createRes.jsonBody?.url ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')
  assert.match(url, new RegExp(`^/activity/${activityName}/${hash}\\?.*entryPolicy=solo-allowed.*urlHash=[a-f0-9]{16}`))

  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  await cleanupPersistentSession(hash)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: {
      persistent_sessions: cookie.value,
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'solo-allowed')
  assert.match(String((sessionsList[0] as Record<string, unknown>).fullUrl ?? ''), /entryPolicy=solo-allowed/)
  assert.match(String((sessionsList[0] as Record<string, unknown>).fullUrl ?? ''), /urlHash=[a-f0-9]{16}/)
})

void test('persistent session entry route honors signed query entryPolicy after persistent metadata is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'signed-solo-link',
      entryPolicy: 'solo-allowed',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  const url = new URL(`https://bits.example${String(createRes.jsonBody?.url ?? '')}`)
  t.after(async () => cleanupPersistentSession(hash))

  await cleanupPersistentSession(hash)

  const entryHandler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')
  const entryReq = createMockReq({
    params: { hash },
    query: {
      activityName: 'java-string-practice',
      entryPolicy: url.searchParams.get('entryPolicy') ?? '',
      urlHash: url.searchParams.get('urlHash') ?? '',
    },
  })
  const entryRes = createMockRes()

  await entryHandler(entryReq, entryRes)

  assert.equal(entryRes.statusCode, 200, JSON.stringify(entryRes.jsonBody))
  assert.equal(entryRes.jsonBody?.entryPolicy, 'solo-allowed')
  assert.equal(entryRes.jsonBody?.entryOutcome, 'continue-solo')
})

void test('update rewrites permalink settings for the same hash and preserves teacher code', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'update-link-code',
      entryPolicy: 'instructor-required',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'java-string-practice',
      hash,
      entryPolicy: 'solo-allowed',
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.equal(updateRes.jsonBody?.hash, hash)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /entryPolicy=solo-allowed/)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /urlHash=[a-f0-9]{16}/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()
  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'solo-allowed')
  assert.equal((sessionsList[0] as Record<string, unknown>).teacherCode, 'update-link-code')
})

void test('update preserves existing selectedOptions when request omits selectedOptions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'preserve-options-code',
      entryPolicy: 'instructor-required',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'algorithm-demo',
      hash,
      entryPolicy: 'solo-allowed',
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /algorithm=merge-sort/)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /entryPolicy=solo-allowed/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)
  const parsedCookie = JSON.parse(updatedCookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsedCookie.find((candidate) => candidate.key === `algorithm-demo:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('remove drops a saved permalink from the teacher cookie list', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'remove-link-code',
      entryPolicy: 'solo-allowed',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const removeHandler = getRoute(app, 'POST', '/api/persistent-session/remove')
  const removeReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'java-string-practice',
      hash,
    },
  })
  const removeRes = createMockRes()

  await removeHandler(removeReq, removeRes)

  assert.equal(removeRes.statusCode, 200, JSON.stringify(removeRes.jsonBody))
  assert.deepEqual(removeRes.jsonBody, { success: true })

  const updatedCookie = removeRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()
  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  assert.deepEqual(listRes.jsonBody, { sessions: [] })
})

void test('getOrCreateActivePersistentSession updates stored entry policy when an existing permalink is reused', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'gallery-walk'
  const teacherCode = 'reused-policy-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')
})

void test('persistent session list omits remembered teacherCode when the cookie entry no longer validates', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')

  const activityName = 'gallery-walk'
  const teacherCode = 'actual-list-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)

  const listRes = createMockRes()
  await listHandler(createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-list-code'),
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  }), listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).teacherCode, undefined)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'instructor-required')
})

void test('authenticate rejects teacher auth for solo-only permalinks without mutating cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'solo-only-teacher'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    body: {
      activityName,
      hash,
      teacherCode,
      entryPolicy: query.get('entryPolicy') ?? '',
      urlHash: query.get('urlHash') ?? '',
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.jsonBody, {
    error: 'This permanent link is configured for solo use only.',
    code: 'entry-policy-rejected',
    entryPolicy: 'solo-only',
  })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate restores teacher cookie from active session id', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, session: unknown) => { sessionMap.set(id, session) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', {
    id: 'live-session',
    type: activityName,
    data: {
      instructorPasscode: 'syncdeck-instructor-passcode',
    },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await updatePersistentSessionUrlState(hash, {
    entryPolicy: 'solo-allowed',
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
  })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody, {
    success: true,
    activityName,
    sessionId: 'live-session',
    createSessionPayload: {
      instructorPasscode: 'syncdeck-instructor-passcode',
    },
  })
  assert.equal(res.headers['cache-control'], 'no-store')
  const managerCapabilityCookie = Array.from(res.cookies.entries()).find(([name]) => name.startsWith('activebits_cap_manager_'))?.[1]
  assert.ok(managerCapabilityCookie)
  assert.equal(managerCapabilityCookie.value.length > 0, true)
  assert.equal(managerCapabilityCookie.options.httpOnly, true)
  assert.notEqual((sessionMap.get('live-session') as { data?: { activityCapabilities?: unknown } }).data?.activityCapabilities, undefined)

  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie?.value ?? '[]') as Array<Record<string, unknown>>
  const teacherJoinEntry = parsed.find((entry) => entry.key === `${activityName}:${hash}`)
  assert.deepEqual(teacherJoinEntry, {
    key: `${activityName}:${hash}`,
    teacherCode,
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
    entryPolicy: 'solo-allowed',
    urlHash: buildPersistentLinkUrlQuery({
      hash,
      entryPolicy: 'solo-allowed',
      selectedOptions: { presentationUrl: 'https://slides.example/deck' },
    }).get('urlHash'),
  })
})

void test('session teacher authenticate does not resurrect a session that ended during the request', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  let getCalls = 0
  const setCalls: string[] = []
  const sessions = {
    get: async (id: string) => {
      getCalls += 1
      // The initial read succeeds; by the time the handler re-reads to issue the
      // capability the session has ended (e.g. the class was closed).
      if (id === 'live-session' && getCalls >= 2) return null
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls.push(id); sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'Teacher join is unavailable for this session' })
  assert.equal(setCalls.length, 0, 'no whole-session write recreated the ended session')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate stays retryable (500) when the strict live-session read rejects', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessions = {
    // A transient store outage must not be flattened to a terminal 404; the
    // strict read rejects into the handler's controlled 500 instead.
    get: async () => { throw new Error('[TEST] session store read (non-strict) unavailable') },
    getStrict: async () => { throw new Error('[TEST] session store read unavailable') },
    set: async () => { throw new Error('[TEST] session store write should not run') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the strict live-session read is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Teacher authentication is temporarily unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate stays retryable (500) when the capability re-read rejects', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  let strictCalls = 0
  const setCalls: string[] = []
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      strictCalls += 1
      // Initial authorization read succeeds; the post-rate-limit re-read that
      // issues the capability then hits a transient store outage.
      if (strictCalls >= 2) throw new Error('[TEST] capability re-read unavailable')
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async (id: string, session: unknown) => { setCalls.push(id); sessionMap.set(id, structuredClone(session)) },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the manager-capability re-read is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'manager capability unavailable' })
  assert.equal(setCalls.length, 0, 'the capability write never runs when the re-read fails')
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate stays retryable (500) when the reverse-index read rejects', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  const originalGet = valkeyClient.get
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index read failed')
    }
    return originalGet(key)
  }
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const sessionMap = new Map<string, unknown>()
  sessionMap.set('live-session', {
    id: 'live-session', type: 'syncdeck', data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async () => { throw new Error('[TEST] session store write should not run') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the reverse-index read is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode: 'teacher-secret' } }), res)

  // The live session read succeeded; a reverse-index backend outage must be a
  // retryable 500, not the terminal 404 the legacy null contract produced.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Teacher authentication is temporarily unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate stays retryable (500) when the fallback scan enumeration rejects', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  // Reverse index genuinely absent (no throw) so the lookup falls through to the
  // legacy scan; the scan enumeration itself is then unavailable.
  valkeyClient.scan = async () => { throw new Error('[TEST] hash enumeration scan failed') }
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })

  const sessionMap = new Map<string, unknown>()
  sessionMap.set('live-session', {
    id: 'live-session', type: 'syncdeck', data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async () => { throw new Error('[TEST] session store write should not run') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the persistent-session hash enumeration is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode: 'teacher-secret' } }), res)

  // An un-indexed session during a scan outage must not be flattened to a 404.
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Teacher authentication is temporarily unavailable' })
})

void test('session teacher authenticate stays retryable (500) when the persistent-record read rejects', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // Reverse index resolves and validates (first persistent-record read), but the
  // route's follow-up strict persistent-record read then fails.
  const originalGet = valkeyClient.get
  let recordReads = 0
  valkeyClient.get = async (key: string) => {
    if (key.startsWith('persistent:')) {
      recordReads += 1
      if (recordReads >= 2) {
        throw new Error('[TEST] persistent record read failed')
      }
    }
    return originalGet(key)
  }

  const sessionMap = new Map<string, unknown>()
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async () => { throw new Error('[TEST] session store write should not run') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the persistent-record read is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Teacher authentication is temporarily unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate stays retryable (500) when the fallback reverse-index backfill rejects', async (t) => {
  const valkeyClient = createFakePersistentValkeyClient()
  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  initializePersistentStorage(valkeyClient as never)
  await initializeActivityRegistry()
  t.after(() => { initializePersistentStorage(null) })
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  // Reverse index is gone (so the lookup drops to the legacy scan), the scan
  // finds the record, but writing the index back then fails. The strict lookup
  // must propagate that - the index-only recovery route would not find this
  // session later, so issuing a manager capability now would be unrecoverable.
  valkeyClient.store.delete('persistent-session-by-session:live-session')
  const originalSet = valkeyClient.set
  valkeyClient.set = async (key: string, value: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index backfill failed')
    }
    return originalSet(key, value)
  }

  const sessionMap = new Map<string, unknown>()
  sessionMap.set('live-session', {
    id: 'live-session', type: activityName, data: { instructorPasscode: 'syncdeck-instructor-passcode' },
  })
  const sessions = {
    get: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    getStrict: async (id: string) => {
      const session = sessionMap.get(id)
      return session == null ? null : structuredClone(session)
    },
    set: async () => { throw new Error('[TEST] session store write should not run') },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const res = createMockRes()
  console.info('[TEST] Expected retryable failure: the fallback reverse-index backfill is unavailable during teacher authentication.')
  await handler(createMockReq({ params: { sessionId: 'live-session' }, body: { teacherCode } }), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.jsonBody, { error: 'Teacher authentication is temporarily unavailable' })
  assert.equal(res.cookies.has(getActivityCapabilityCookieName('manager', 'live-session')), false)
})

void test('session teacher authenticate rejects invalid teacher code', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.jsonBody, { error: 'Invalid teacher code' })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rejects active session activity mismatch', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: 'gallery-walk' })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'Teacher join is unavailable for this session' })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rate limits repeated invalid attempts per client and session', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      ip: '203.0.113.9',
    })
    const res = createMockRes()
    await handler(req, res)

    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.jsonBody, { error: 'Invalid teacher code' })
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    ip: '203.0.113.9',
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
  assert.equal(blockedRes.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rate limiting ignores spoofed forwarded headers when req.ip is present', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
    })
    const res = createMockRes()
    await handler(req, res)
    assert.equal(res.statusCode, 401)
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    ip: '203.0.113.9',
    headers: { 'x-forwarded-for': '198.51.100.200' },
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
})

void test('session teacher authenticate rate limits by socket remote address when req.ip is unavailable', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      remoteAddress: '203.0.113.10',
    })
    const res = createMockRes()
    await handler(req, res)
    assert.equal(res.statusCode, 401)
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    remoteAddress: '203.0.113.10',
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
})
