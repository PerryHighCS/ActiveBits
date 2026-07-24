import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import { buildLearnHmacCanonicalRequest, registerLearnSyncDeckRoutes } from './learnIntegration.js'

interface MockResponse {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
  redirectTo: string | null
  status(code: number): MockResponse
  json(payload: unknown): void
  cookie(name: string, value: string, options: Record<string, unknown>): void
  redirect(status: number, url: string): void
  setHeader(name: string, value: string): void
}

interface MockRequest {
  params: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, unknown>
  cookies?: Record<string, unknown>
  query?: Record<string, unknown>
}

type RouteHandler = (req: MockRequest, res: MockResponse) => Promise<void> | void

function response(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookies: [],
    redirectTo: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload },
    cookie(name, value, options) { this.cookies.push({ name, value, options }) },
    redirect(status, url) { this.statusCode = status; this.redirectTo = url },
    setHeader(name, value) { this.headers[name] = value },
  }
}

function store(broadcasts: Array<{ event: string; payload: unknown }>): SessionStore {
  const records = new Map<string, SessionRecord>()
  return {
    async get(id) { return records.get(id) ? structuredClone(records.get(id)!) : null },
    async set(id, session) { records.set(id, structuredClone(session)) },
    async delete(id) { return records.delete(id) },
    async touch() { return true },
    async getAll() { return Array.from(records.values()).map((item) => structuredClone(item)) },
    async getAllIds() { return Array.from(records.keys()) },
    async consumeSessionDataToken(id, field, value) {
      const session = records.get(id)
      const entry = session?.data[field] as { value?: unknown; expiresAt?: unknown } | undefined
      if (!session || entry?.value !== value || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()) return null
      const next = structuredClone(session)
      delete next.data[field]
      records.set(id, next)
      return structuredClone(next)
    },
    cleanup() {},
    async close() {},
    async publishBroadcast(event, payload) { broadcasts.push({ event, payload }) },
    ttlMs: 60_000,
  }
}

function signedRequest(method: string, path: string, body: unknown, nonce: string) {
  const timestamp = String(Date.now())
  const secret = process.env.LEARN_SYNCDECK_HMAC_SECRET!
  return {
    body,
    headers: {
      'x-learn-key-id': 'test-key',
      'x-learn-provider': 'learn-test',
      'x-learn-timestamp': timestamp,
      'x-learn-nonce': nonce,
      'x-learn-signature': createHmac('sha256', secret)
        .update(buildLearnHmacCanonicalRequest(method, path, timestamp, nonce, 'learn-test', body), 'utf8')
        .digest('hex'),
    },
  }
}

void test('Learn routes transition a one-time waiting-room entry into an active SyncDeck session', async () => {
  const previousSecret = process.env.LEARN_SYNCDECK_HMAC_SECRET
  const previousKeyId = process.env.LEARN_SYNCDECK_HMAC_KEY_ID
  const previousInfo = console.info
  const infoLogs: string[] = []
  process.env.LEARN_SYNCDECK_HMAC_SECRET = 'a test-only Learn integration secret that is long enough'
  process.env.LEARN_SYNCDECK_HMAC_KEY_ID = 'test-key'
  console.info = (...args: unknown[]) => { infoLogs.push(args.map(String).join(' ')) }
  previousInfo('[TEST] Expected Learn integration failure logs are captured by this test.')

  try {
    const getHandlers = new Map<string, RouteHandler>()
    const postHandlers = new Map<string, RouteHandler>()
    const broadcasts: Array<{ event: string; payload: unknown }> = []
    const sessions = store(broadcasts)
    const ws: WsRouter = { wss: { clients: new Set<ActiveBitsWebSocket>(), close() {} }, register() {} }
    let createdSessionId = ''
    registerLearnSyncDeckRoutes({
      app: {
        get(path, handler) { getHandlers.set(path, handler) },
        post(path, handler) { postHandlers.set(path, handler) },
      },
      sessions,
      ws,
      async createInstructorSession() {
        createdSessionId = 'syncdeck-live'
        await sessions.set(createdSessionId, {
          id: createdSessionId,
          type: 'syncdeck',
          created: Date.now(),
          lastActivity: Date.now(),
          data: { instructorRecoveryToken: 'a'.repeat(64) },
        })
        return { sessionId: createdSessionId, instructorRecoveryToken: 'a'.repeat(64) }
      },
      writeInstructorRecoveryCookie(_req, res) {
        res.cookie?.('syncdeck_instructor_recoveries', 'recovered', {})
      },
    })

    const resourceId = 'learn-resource-1'
    const missingAuthenticationResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId } },
      missingAuthenticationResponse,
    )
    assert.equal(missingAuthenticationResponse.statusCode, 401)
    assert.ok(infoLogs.some((message) => message.includes('learn-integration-request-failed') && message.includes('"route":"status"') && message.includes('"status":401')))

    const statusPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${resourceId}/status`
    const tamperedRequest = signedRequest('GET', statusPath, {}, 'tampered-signature-nonce')
    tamperedRequest.headers['x-learn-signature'] = '0'.repeat(64)
    const tamperedSignatureResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...tamperedRequest },
      tamperedSignatureResponse,
    )
    assert.equal(tamperedSignatureResponse.statusCode, 401)

    const invalidResourceResponse = response()
    const invalidResourcePath = '/api/integrations/learn/v1/activities/syncdeck/resources/%20/status'
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: ' ' }, ...signedRequest('GET', invalidResourcePath, {}, 'invalid-resource-nonce') },
      invalidResourceResponse,
    )
    assert.equal(invalidResourceResponse.statusCode, 400)

    const entryPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${resourceId}/student-entry`
    const entryResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/student-entry')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', entryPath, {}, 'student-entry-nonce') },
      entryResponse,
    )
    assert.equal(entryResponse.statusCode, 200)
    const waitingLaunchUrl = String((entryResponse.body as { waitingLaunchUrl: string }).waitingLaunchUrl)
    const launchUrl = new URL(waitingLaunchUrl, 'https://bits.example')

    const invalidWaitLaunchResponse = response()
    await getHandlers.get('/integrations/learn/:activityId/wait/:tokenId')!(
      { params: { activityId: 'syncdeck', tokenId: launchUrl.pathname.split('/').at(-1) }, query: { token: 'invalid-token' } },
      invalidWaitLaunchResponse,
    )
    assert.equal(invalidWaitLaunchResponse.statusCode, 403)

    console.info('[TEST] Expected waiting-room launch rejection while Learn integration is unconfigured.')
    delete process.env.LEARN_SYNCDECK_HMAC_SECRET
    const unconfiguredWaitLaunchResponse = response()
    await getHandlers.get('/integrations/learn/:activityId/wait/:tokenId')!(
      { params: { activityId: 'syncdeck', tokenId: launchUrl.pathname.split('/').at(-1) }, query: { token: launchUrl.searchParams.get('token') } },
      unconfiguredWaitLaunchResponse,
    )
    assert.equal(unconfiguredWaitLaunchResponse.statusCode, 403)
    process.env.LEARN_SYNCDECK_HMAC_SECRET = 'a test-only Learn integration secret that is long enough'

    const waitLaunchResponse = response()
    await getHandlers.get('/integrations/learn/:activityId/wait/:tokenId')!(
      { params: { activityId: 'syncdeck', tokenId: launchUrl.pathname.split('/').at(-1) }, query: { token: launchUrl.searchParams.get('token') } },
      waitLaunchResponse,
    )
    assert.equal(waitLaunchResponse.redirectTo, '/integrations/learn/syncdeck/wait')
    assert.equal(waitLaunchResponse.headers['Referrer-Policy'], 'no-referrer')
    const waitCookie = waitLaunchResponse.cookies.find((item) => item.name === 'learn_syncdeck_wait')
    assert.equal(waitCookie?.options.path, '/')
    const waitingCookie = waitCookie?.value
    assert.ok(waitingCookie)

    const startPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${resourceId}/start`
    const startResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-1' }, 'start-nonce') },
      startResponse,
    )
    assert.equal(startResponse.statusCode, 200)
    assert.equal((startResponse.body as { activeSessionId?: unknown }).activeSessionId, createdSessionId)

    const instructorLaunchUrl = new URL(String((startResponse.body as { instructorLaunchUrl: string }).instructorLaunchUrl), 'https://bits.example')
    const instructorLaunchResponse = response()
    await getHandlers.get('/integrations/learn/:activityId/instructor/:tokenId')!(
      { params: { activityId: 'syncdeck', tokenId: instructorLaunchUrl.pathname.split('/').at(-1) }, query: { token: instructorLaunchUrl.searchParams.get('token') } },
      instructorLaunchResponse,
    )
    assert.equal(instructorLaunchResponse.redirectTo, `/manage/syncdeck/${createdSessionId}`)
    assert.equal(instructorLaunchResponse.headers['Referrer-Policy'], 'no-referrer')
    assert.deepEqual(instructorLaunchResponse.cookies, [{ name: 'syncdeck_instructor_recoveries', value: 'recovered', options: {} }])

    const waitStatusResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/wait/status')!(
      { params: { activityId: 'syncdeck' }, cookies: { learn_syncdeck_wait: waitingCookie } },
      waitStatusResponse,
    )
    assert.deepEqual(waitStatusResponse.body, { state: 'active', studentLaunchUrl: '/syncdeck-live' })

    const replayResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-1' }, 'start-nonce') },
      replayResponse,
    )
    assert.equal(replayResponse.statusCode, 401)
    assert.match(String((replayResponse.body as { error?: unknown }).error), /replayed/i)

    const stopPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${resourceId}/stop`
    const stopResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/stop')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', stopPath, {}, 'stop-nonce') },
      stopResponse,
    )
    assert.deepEqual(stopResponse.body, { state: 'inactive', alreadyInactive: false })
    assert.equal(typeof (await sessions.get(createdSessionId))?.data.learnIntegrationStoppedAt, 'number')
    assert.deepEqual(broadcasts, [{ event: 'session-ended', payload: { sessionId: createdSessionId } }])

    console.info('[TEST] Expected idempotent Learn stop no-op log.')
    const repeatedStopResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/stop')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', stopPath, {}, 'stop-noop-nonce') },
      repeatedStopResponse,
    )
    assert.equal(repeatedStopResponse.statusCode, 200)
    assert.deepEqual(repeatedStopResponse.body, { state: 'inactive', alreadyInactive: true })
    assert.ok(infoLogs.some((message) => message.includes('learn-integration-stop-noop') && message.includes('"reason":"already-inactive"')))
  } finally {
    console.info = previousInfo
    if (previousSecret === undefined) delete process.env.LEARN_SYNCDECK_HMAC_SECRET
    else process.env.LEARN_SYNCDECK_HMAC_SECRET = previousSecret
    if (previousKeyId === undefined) delete process.env.LEARN_SYNCDECK_HMAC_KEY_ID
    else process.env.LEARN_SYNCDECK_HMAC_KEY_ID = previousKeyId
  }
})
