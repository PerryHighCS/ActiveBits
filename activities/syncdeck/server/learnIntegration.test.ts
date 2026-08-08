import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
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
  send(body: string): void
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
    send(body) { this.body = body },
  }
}

function store(broadcasts: Array<{ event: string; payload: unknown }>): SessionStore {
  const records = new Map<string, SessionRecord>()
  return {
    async get(id) { return records.get(id) ? structuredClone(records.get(id)!) : null },
    async set(id, session) { records.set(id, structuredClone(session)) },
    async delete(id) { return records.delete(id) },
    async touch() { return true },
    async refreshSessionExpiry(id, expectedExpiresAt, nextExpiresAt) {
      const session = records.get(id)
      if (!session || session.data.expiresAt !== expectedExpiresAt) return null
      const refreshed = structuredClone(session)
      refreshed.data.expiresAt = nextExpiresAt
      records.set(id, refreshed)
      return structuredClone(refreshed)
    },
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

function substituteInstructorLink(resourceLinkId: string, presentationUrl: string, jti = 'substitute-link-test', expiresAt = Date.now() + 60_000) {
  const secret = process.env.LEARN_SYNCDECK_HMAC_SECRET!
  const payload = Buffer.from(JSON.stringify({ expiresAt, jti, presentationUrl, provider: 'learn-test', resourceLinkId, v: 1 }), 'utf8').toString('base64url')
  return {
    payload,
    sig: createHmac('sha256', secret).update(`LEARN_SYNCDECK_SUBSTITUTE_LINK\n${payload}`, 'utf8').digest('hex'),
  }
}

void test('buildLearnHmacCanonicalRequest orders object keys by codepoint', () => {
  const request = buildLearnHmacCanonicalRequest('POST', '/path', '123', 'nonce', 'provider', { ä: 'umlaut', z: 'zee' })
  const expectedHash = createHash('sha256').update('{"z":"zee","ä":"umlaut"}', 'utf8').digest('hex')
  assert.equal(request, `POST\n/path\n123\nnonce\nprovider\n${expectedHash}`)
})

void test('Learn routes transition a one-time waiting-room entry into an active SyncDeck session', async () => {
  const previousSecret = process.env.LEARN_SYNCDECK_HMAC_SECRET
  const previousKeyId = process.env.LEARN_SYNCDECK_HMAC_KEY_ID
  const previousInfo = console.info
  const previousError = console.error
  const infoLogs: string[] = []
  const errorLogs: string[] = []
  process.env.LEARN_SYNCDECK_HMAC_SECRET = 'a test-only Learn integration secret that is long enough'
  process.env.LEARN_SYNCDECK_HMAC_KEY_ID = 'test-key'
  console.info = (...args: unknown[]) => { infoLogs.push(args.map(String).join(' ')) }
  console.error = (...args: unknown[]) => { errorLogs.push(args.map(String).join(' ')) }
  previousInfo('[TEST] Expected Learn integration failure logs are captured by this test.')

  try {
    const getHandlers = new Map<string, RouteHandler>()
    const postHandlers = new Map<string, RouteHandler>()
    const broadcasts: Array<{ event: string; payload: unknown }> = []
    const sessions = store(broadcasts)
    const ws: WsRouter = { wss: { clients: new Set<ActiveBitsWebSocket>(), close() {} }, register() {} }
    let createdSessionId = ''
    let instructorSessionCreateCount = 0
    let delayedInstructorSession: Promise<void> | null = null
    let notifyInstructorSessionStart: (() => void) | null = null
    let failInstructorSessionCreation = false
    registerLearnSyncDeckRoutes({
      app: {
        get(path, handler) { getHandlers.set(path, handler) },
        post(path, handler) { postHandlers.set(path, handler) },
      },
      sessions,
      ws,
      async createInstructorSession() {
        instructorSessionCreateCount += 1
        notifyInstructorSessionStart?.()
        if (delayedInstructorSession) await delayedInstructorSession
        if (failInstructorSessionCreation) throw new Error('test instructor-session creation failure')
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
    console.info('[TEST] Expected unconfigured Learn integration to be logged as a configuration state.')
    delete process.env.LEARN_SYNCDECK_HMAC_SECRET
    const unconfiguredStatusResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId } },
      unconfiguredStatusResponse,
    )
    assert.equal(unconfiguredStatusResponse.statusCode, 503)
    assert.ok(infoLogs.some((message) => message.includes('learn-integration-request-failed') && message.includes('"reason":"integration-not-configured"') && message.includes('"status":503')))
    process.env.LEARN_SYNCDECK_HMAC_SECRET = 'a test-only Learn integration secret that is long enough'

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

    const initialStudentEntryLog = JSON.parse(
      infoLogs.find((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"student-entry"'))!,
    ) as Record<string, unknown>
    assert.equal(initialStudentEntryLog.state, 'waiting')
    assert.equal(initialStudentEntryLog.reused, false)
    assert.equal(initialStudentEntryLog.sessionFingerprint, null)
    assert.match(String(initialStudentEntryLog.providerFingerprint), /^[a-f0-9]{16}$/)
    assert.match(String(initialStudentEntryLog.resourceLinkFingerprint), /^[a-f0-9]{16}$/)
    assert.match(String(initialStudentEntryLog.mappingFingerprint), /^[a-f0-9]{16}$/)
    const resourceMappingFingerprint = initialStudentEntryLog.mappingFingerprint

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
    let releaseDelayedStart!: () => void
    delayedInstructorSession = new Promise<void>((resolve) => { releaseDelayedStart = resolve })
    let resolveInstructorSessionStart!: () => void
    const instructorSessionStarted = new Promise<void>((resolve) => { resolveInstructorSessionStart = resolve })
    notifyInstructorSessionStart = resolveInstructorSessionStart
    const startResponse = response()
    const firstStart = postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-1' }, 'start-nonce') },
      startResponse,
    )
    await instructorSessionStarted
    const repeatedInFlightStartResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-1' }, 'start-retry-nonce') },
      repeatedInFlightStartResponse,
    )
    assert.equal(repeatedInFlightStartResponse.statusCode, 202)
    assert.deepEqual(repeatedInFlightStartResponse.body, { state: 'starting', activeSessionId: null, reused: false })
    releaseDelayedStart()
    await firstStart
    delayedInstructorSession = null
    notifyInstructorSessionStart = null
    assert.equal(startResponse.statusCode, 200)
    assert.equal((startResponse.body as { activeSessionId?: unknown }).activeSessionId, createdSessionId)

    const startIdentityLog = JSON.parse(
      infoLogs.find((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"start"'))!,
    ) as Record<string, unknown>
    assert.equal(startIdentityLog.state, 'active')
    assert.equal(startIdentityLog.reused, false)
    assert.equal(startIdentityLog.mappingFingerprint, resourceMappingFingerprint)
    assert.match(String(startIdentityLog.sessionFingerprint), /^[a-f0-9]{16}$/)
    const startedSessionFingerprint = startIdentityLog.sessionFingerprint
    assert.ok(infoLogs.some((message) => message.includes('learn-instructor-session-start-pending') && message.includes(`"mappingFingerprint":"${resourceMappingFingerprint}"`)))
    const pendingStartLog = JSON.parse(
      infoLogs.find((message) => message.includes('"event":"learn-instructor-session-start-pending"'))!,
    ) as Record<string, unknown>
    assert.equal(pendingStartLog.requestId, 'start-1')
    assert.equal(pendingStartLog.state, 'starting')
    assert.equal(pendingStartLog.resourceLinkId, undefined)
    assert.match(String(pendingStartLog.resourceLinkFingerprint), /^[a-f0-9]{16}$/)

    const learnEntryIds = (await sessions.getAllIds()).filter((candidateId) => candidateId.startsWith('learn-syncdeck-entry-'))
    let resourceEntryId: string | undefined
    for (const candidateId of learnEntryIds) {
      const candidate = await sessions.get(candidateId)
      if ((candidate?.data as { resourceLinkId?: unknown })?.resourceLinkId === resourceId) {
        resourceEntryId = candidateId
        break
      }
    }
    assert.ok(resourceEntryId, 'expected exactly one Learn entry mapping for resourceId')
    const liveSessionRecord = await sessions.get(createdSessionId)
    assert.equal(
      (liveSessionRecord?.data as { linkedSessionId?: unknown })?.linkedSessionId,
      resourceEntryId,
      'starting a Learn instructor session should stamp the live session with its entry mapping id so websocket keepalive refreshes the entry too',
    )

    ws.wss.clients.add({ readyState: 1, sessionId: createdSessionId, isInstructor: true } as unknown as ActiveBitsWebSocket)
    ws.wss.clients.add({ readyState: 1, sessionId: createdSessionId, studentId: 'student-1' } as unknown as ActiveBitsWebSocket)
    ws.wss.clients.add({ readyState: 1, sessionId: createdSessionId, studentId: 'student-1' } as unknown as ActiveBitsWebSocket)
    const activeStatusResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('GET', statusPath, {}, 'active-status-nonce') },
      activeStatusResponse,
    )
    assert.equal(activeStatusResponse.statusCode, 200)
    assert.deepEqual(
      {
        state: (activeStatusResponse.body as { state: unknown }).state,
        joinCode: (activeStatusResponse.body as { joinCode: unknown }).joinCode,
        participantCount: (activeStatusResponse.body as { participantCount: unknown }).participantCount,
        instructorCount: (activeStatusResponse.body as { instructorCount: unknown }).instructorCount,
        activeSessionId: (activeStatusResponse.body as { activeSessionId: unknown }).activeSessionId,
        studentLaunchUrl: (activeStatusResponse.body as { studentLaunchUrl: unknown }).studentLaunchUrl,
        connectedParticipantCount: (activeStatusResponse.body as { connectedParticipantCount: unknown }).connectedParticipantCount,
        connectedInstructorCount: (activeStatusResponse.body as { connectedInstructorCount: unknown }).connectedInstructorCount,
      },
      {
        state: 'active',
        joinCode: createdSessionId,
        participantCount: 1,
        instructorCount: 1,
        activeSessionId: createdSessionId,
        studentLaunchUrl: `/${createdSessionId}`,
        connectedParticipantCount: 1,
        connectedInstructorCount: 1,
      },
    )

    const statusIdentityLog = JSON.parse(
      infoLogs.find((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"status"') && message.includes('"state":"active"'))!,
    ) as Record<string, unknown>
    assert.equal(statusIdentityLog.mappingFingerprint, resourceMappingFingerprint)
    assert.equal(statusIdentityLog.sessionFingerprint, startedSessionFingerprint)
    assert.equal(statusIdentityLog.reused, undefined)

    const substituteLaunch = substituteInstructorLink(resourceId, 'https://slides.example/deck')
    const substituteLaunchResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteLaunch },
      substituteLaunchResponse,
    )
    assert.equal(substituteLaunchResponse.statusCode, 302)
    assert.equal(substituteLaunchResponse.redirectTo, `/manage/syncdeck/${createdSessionId}`)
    assert.equal(substituteLaunchResponse.headers['Referrer-Policy'], 'no-referrer')
    assert.ok(substituteLaunchResponse.cookies.some((item) => item.name === 'syncdeck_instructor_recoveries'))

    const reusedSubstituteLaunchResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteLaunch },
      reusedSubstituteLaunchResponse,
    )
    assert.equal(reusedSubstituteLaunchResponse.statusCode, 302)
    assert.equal(reusedSubstituteLaunchResponse.redirectTo, `/manage/syncdeck/${createdSessionId}`)
    assert.ok(reusedSubstituteLaunchResponse.cookies.some((item) => item.name === 'syncdeck_instructor_recoveries'))
    assert.equal(instructorSessionCreateCount, 1)
    assert.ok(infoLogs.some((message) => message.includes('learn-substitute-link-launched') && message.includes('"reused":true')))

    console.info('[TEST] Expected substitute launch with an active mismatched deck to return a non-retryable response.')
    const mismatchedDeckSubstituteResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteInstructorLink(resourceId, 'https://slides.example/other-deck') },
      mismatchedDeckSubstituteResponse,
    )
    assert.equal(mismatchedDeckSubstituteResponse.statusCode, 409)
    assert.equal(mismatchedDeckSubstituteResponse.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.match(String(mismatchedDeckSubstituteResponse.body), /Presentation URL cannot change while the instructor session is active/)
    assert.match(String(mismatchedDeckSubstituteResponse.body), /Ask the instructor who shared this link for a new one/)
    assert.ok(infoLogs.some((message) => message.includes('learn-substitute-link-presentation-url-mismatch') && message.includes('"status":409')))

    console.info('[TEST] Expected invalid substitute instructor link to fail closed.')
    const invalidSubstituteResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: { payload: substituteLaunch.payload, sig: '0'.repeat(64) } },
      invalidSubstituteResponse,
    )
    assert.equal(invalidSubstituteResponse.statusCode, 403)
    assert.equal(invalidSubstituteResponse.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.match(String(invalidSubstituteResponse.body), /SyncDeck launch unavailable/)

    console.info('[TEST] Expected expired substitute instructor link to fail closed.')
    const expiredSubstituteResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteInstructorLink(resourceId, 'https://slides.example/deck', 'expired-substitute-link', Date.now() - 1) },
      expiredSubstituteResponse,
    )
    assert.equal(expiredSubstituteResponse.statusCode, 403)

    const instructorLaunchUrl = new URL(String((startResponse.body as { instructorLaunchUrl: string }).instructorLaunchUrl), 'https://bits.example')
    const instructorLaunchResponse = response()
    await getHandlers.get('/api/syncdeck/learn/instructor/:tokenId')!(
      { params: { tokenId: instructorLaunchUrl.pathname.split('/').at(-1) }, query: { token: instructorLaunchUrl.searchParams.get('token') } },
      instructorLaunchResponse,
    )
    assert.equal(instructorLaunchResponse.redirectTo, `/manage/syncdeck/${createdSessionId}`)
    assert.equal(instructorLaunchResponse.headers['Referrer-Policy'], 'no-referrer')
    assert.deepEqual(instructorLaunchResponse.cookies, [{ name: 'syncdeck_instructor_recoveries', value: 'recovered', options: {} }])

    const activeSessionWithoutRecovery = await sessions.get(createdSessionId)
    assert.ok(activeSessionWithoutRecovery)
    delete activeSessionWithoutRecovery.data.instructorRecoveryToken
    await sessions.set(createdSessionId, activeSessionWithoutRecovery)
    console.info('[TEST] Expected substitute launch without active recovery state to fail closed.')
    const missingRecoverySubstituteResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteLaunch },
      missingRecoverySubstituteResponse,
    )
    assert.equal(missingRecoverySubstituteResponse.statusCode, 500)
    assert.equal(missingRecoverySubstituteResponse.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.match(String(missingRecoverySubstituteResponse.body), /Active instructor recovery is unavailable/)
    assert.equal(instructorSessionCreateCount, 1)

    const waitStatusResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/wait/status')!(
      { params: { activityId: 'syncdeck' }, cookies: { learn_syncdeck_wait: waitingCookie } },
      waitStatusResponse,
    )
    assert.deepEqual(waitStatusResponse.body, { state: 'active', studentLaunchUrl: '/syncdeck-live' })

    const startingSubstituteResourceId = 'learn-resource-substitute-starting'
    const startingSubstituteLaunch = substituteInstructorLink(startingSubstituteResourceId, 'https://slides.example/substitute-starting', 'substitute-starting')
    const startingStudentEntryPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${startingSubstituteResourceId}/student-entry`
    const startingStudentEntryResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/student-entry')!(
      { params: { activityId: 'syncdeck', resourceLinkId: startingSubstituteResourceId }, ...signedRequest('POST', startingStudentEntryPath, {}, 'substitute-starting-student-entry') },
      startingStudentEntryResponse,
    )
    assert.equal((startingStudentEntryResponse.body as { state?: unknown }).state, 'waiting')
    const otherResourceStudentEntryLogs = infoLogs.filter((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"student-entry"'))
    const otherResourceIdentityLog = JSON.parse(otherResourceStudentEntryLogs.at(-1)!) as Record<string, unknown>
    assert.notEqual(otherResourceIdentityLog.mappingFingerprint, resourceMappingFingerprint)
    assert.notEqual(otherResourceIdentityLog.resourceLinkFingerprint, initialStudentEntryLog.resourceLinkFingerprint)
    let releaseDelayedSubstituteStart!: () => void
    delayedInstructorSession = new Promise<void>((resolve) => { releaseDelayedSubstituteStart = resolve })
    let resolveSubstituteSessionStart!: () => void
    const substituteSessionStarted = new Promise<void>((resolve) => { resolveSubstituteSessionStart = resolve })
    notifyInstructorSessionStart = resolveSubstituteSessionStart
    const firstSubstituteLaunch = getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: startingSubstituteLaunch },
      response(),
    )
    await substituteSessionStarted
    const inProgressSubstituteResponse = response()
    console.info('[TEST] Expected a duplicate substitute launch to report the pending session start.')
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: startingSubstituteLaunch },
      inProgressSubstituteResponse,
    )
    assert.equal(inProgressSubstituteResponse.statusCode, 202)
    assert.equal(inProgressSubstituteResponse.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.match(String(inProgressSubstituteResponse.body), /SyncDeck session is starting/)
    assert.ok(infoLogs.some((message) => message.includes('learn-substitute-link-start-pending') && message.includes('"status":202')))
    const contendedSubstituteResponse = response()
    console.info('[TEST] Expected a different substitute launch to report the in-progress session start.')
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteInstructorLink(startingSubstituteResourceId, 'https://slides.example/substitute-starting', 'substitute-contended') },
      contendedSubstituteResponse,
    )
    assert.equal(contendedSubstituteResponse.statusCode, 409)
    assert.equal(contendedSubstituteResponse.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.match(String(contendedSubstituteResponse.body), /SyncDeck session is starting/)
    assert.ok(infoLogs.some((message) => message.includes('learn-substitute-link-start-in-progress') && message.includes('"status":409')))
    releaseDelayedSubstituteStart()
    await firstSubstituteLaunch
    assert.ok(infoLogs.some((message) => message.includes('learn-substitute-link-launched') && message.includes('"reused":false')))
    delayedInstructorSession = null
    notifyInstructorSessionStart = null

    console.info('[TEST] Expected substitute-launch cleanup failures to preserve the safe error response.')
    const originalDeleteForSubstituteCleanup = sessions.delete.bind(sessions)
    sessions.delete = async (id) => {
      if (id.startsWith('learn-syncdeck-entry-')) throw new Error('test substitute cleanup failure')
      return await originalDeleteForSubstituteCleanup(id)
    }
    failInstructorSessionCreation = true
    const substituteCleanupFailureResponse = response()
    await getHandlers.get('/api/syncdeck/learn/substitute')!(
      { params: {}, query: substituteInstructorLink('learn-resource-substitute-cleanup', 'https://slides.example/substitute-cleanup', 'substitute-cleanup') },
      substituteCleanupFailureResponse,
    )
    assert.equal(substituteCleanupFailureResponse.statusCode, 500)
    assert.ok(errorLogs.some((message) => message.includes('learn-substitute-link-start-cleanup-failed') && message.includes('test substitute cleanup failure')))
    assert.ok(errorLogs.some((message) => message.includes('learn-substitute-link-start-failed') && message.includes('test instructor-session creation failure')))
    sessions.delete = originalDeleteForSubstituteCleanup
    failInstructorSessionCreation = false

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

    const stopIdentityLog = JSON.parse(
      infoLogs.find((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"stop"') && message.includes('"sessionFingerprint":"'))!,
    ) as Record<string, unknown>
    assert.equal(stopIdentityLog.mappingFingerprint, resourceMappingFingerprint)
    assert.equal(stopIdentityLog.sessionFingerprint, startedSessionFingerprint)

    console.info('[TEST] Expected idempotent Learn stop no-op log.')
    const repeatedStopResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/stop')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', stopPath, {}, 'stop-noop-nonce') },
      repeatedStopResponse,
    )
    assert.equal(repeatedStopResponse.statusCode, 200)
    assert.deepEqual(repeatedStopResponse.body, { state: 'inactive', alreadyInactive: true })
    assert.ok(infoLogs.some((message) => message.includes('learn-integration-stop-noop') && message.includes('"reason":"already-inactive"')))

    const noopStopIdentityLog = JSON.parse(
      infoLogs.filter((message) => message.includes('"event":"learn-identity-resolved"') && message.includes('"operation":"stop"')).at(-1)!,
    ) as Record<string, unknown>
    assert.equal(noopStopIdentityLog.state, 'inactive')
    assert.equal(noopStopIdentityLog.sessionFingerprint, null)

    console.info('[TEST] Expected Learn instructor-session creation failure to return a safe server error.')
    failInstructorSessionCreation = true
    const failedInstructorStartResponse = response()
    const failedInstructorResourceId = 'learn-resource-start-failure'
    const failedInstructorStartPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${failedInstructorResourceId}/start`
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: failedInstructorResourceId }, ...signedRequest('POST', failedInstructorStartPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-creation-failure' }, 'start-creation-failure-nonce') },
      failedInstructorStartResponse,
    )
    assert.equal(failedInstructorStartResponse.statusCode, 500)
    assert.match(String((failedInstructorStartResponse.body as { error?: unknown }).error), /unable to start/i)
    assert.ok(errorLogs.some((message) => message.includes('learn-instructor-session-start-failed')))
    failInstructorSessionCreation = false

    console.info('[TEST] Expected Learn start to release its lock after a mapping-load failure.')
    const originalGet = sessions.get.bind(sessions)
    let failNextEntryLoad = true
    sessions.get = async (id) => {
      if (failNextEntryLoad && id.startsWith('learn-syncdeck-entry-')) {
        failNextEntryLoad = false
        throw new Error('test mapping-load failure')
      }
      return await originalGet(id)
    }
    const failedStartRequest = signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-after-load-failure' }, 'start-load-failure-nonce')
    const failedStartResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...failedStartRequest },
      failedStartResponse,
    )
    assert.equal(failedStartResponse.statusCode, 503)
    assert.match(String((failedStartResponse.body as { error?: unknown }).error), /coordination is unavailable/i)
    assert.ok(errorLogs.some((message) => message.includes('learn-session-store-unavailable') && message.includes('test mapping-load failure')))
    const retryStartResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-after-load-failure-retry' }, 'start-load-failure-retry-nonce') },
      retryStartResponse,
    )
    assert.equal(retryStartResponse.statusCode, 200)

    console.info('[TEST] Expected Learn status to fall back after a session-expiry refresh failure.')
    const originalRefreshSessionExpiry = sessions.refreshSessionExpiry
    sessions.refreshSessionExpiry = async () => { throw new Error('test expiry-refresh outage') }
    const refreshFailureStatusResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('GET', statusPath, {}, 'expiry-refresh-outage-nonce') },
      refreshFailureStatusResponse,
    )
    assert.equal(refreshFailureStatusResponse.statusCode, 200)
    assert.equal((refreshFailureStatusResponse.body as { state?: unknown }).state, 'active')
    assert.ok(errorLogs.some((message) => message.includes('learn-entry-expiry-refresh-failed') && message.includes('test expiry-refresh outage')))
    sessions.refreshSessionExpiry = originalRefreshSessionExpiry

    console.info('[TEST] Expected Learn nonce-store outage to return a retryable server error.')
    sessions.valkeyStore = {
      client: {
        async set() { throw new Error('test nonce-store outage') },
      },
    } as unknown as SessionStore['valkeyStore']
    const nonceStoreFailureResponse = response()
    await getHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/status')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('GET', statusPath, {}, 'nonce-store-outage-nonce') },
      nonceStoreFailureResponse,
    )
    assert.equal(nonceStoreFailureResponse.statusCode, 503)
    assert.match(String((nonceStoreFailureResponse.body as { error?: unknown }).error), /nonce storage/i)
    assert.ok(errorLogs.some((message) => message.includes('learn-nonce-claim-failed')))
    assert.ok(infoLogs.some((message) => message.includes('learn-integration-request-failed') && message.includes('"reason":"nonce-storage-unavailable"') && message.includes('"status":503')))

    console.info('[TEST] Expected Learn start-lock outage to return a retryable server error.')
    let valkeySetCalls = 0
    sessions.valkeyStore = {
      client: {
        async set() {
          valkeySetCalls += 1
          if (valkeySetCalls === 1) return 'OK'
          throw new Error('test start-lock outage')
        },
      },
    } as unknown as SessionStore['valkeyStore']
    const startLockFailureResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: resourceId }, ...signedRequest('POST', startPath, { presentationUrl: 'https://slides.example/deck', requestId: 'start-lock-outage' }, 'start-lock-outage-nonce') },
      startLockFailureResponse,
    )
    assert.equal(startLockFailureResponse.statusCode, 503)
    assert.match(String((startLockFailureResponse.body as { error?: unknown }).error), /coordination/i)
    assert.ok(errorLogs.some((message) => message.includes('learn-start-lock-claim-failed')))

    console.info('[TEST] Expected Learn start to resolve the active-entry TTL from valkeyStore.ttlMs when the wrapped store omits a top-level ttlMs, matching production Valkey wiring.')
    const ttlFallbackResourceId = 'learn-resource-ttl-fallback'
    const ttlFallbackStartPath = `/api/integrations/learn/v1/activities/syncdeck/resources/${ttlFallbackResourceId}/start`
    const originalTtlMs = sessions.ttlMs
    sessions.ttlMs = undefined
    sessions.valkeyStore = { ttlMs: 4_242_000 } as unknown as SessionStore['valkeyStore']
    const beforeTtlFallbackStart = Date.now()
    const ttlFallbackStartResponse = response()
    await postHandlers.get('/api/integrations/learn/v1/activities/:activityId/resources/:resourceLinkId/start')!(
      { params: { activityId: 'syncdeck', resourceLinkId: ttlFallbackResourceId }, ...signedRequest('POST', ttlFallbackStartPath, { presentationUrl: 'https://slides.example/ttl-fallback', requestId: 'ttl-fallback-start' }, 'ttl-fallback-nonce') },
      ttlFallbackStartResponse,
    )
    assert.equal(ttlFallbackStartResponse.statusCode, 200)
    let ttlFallbackEntryId: string | undefined
    for (const candidateId of await sessions.getAllIds()) {
      if (!candidateId.startsWith('learn-syncdeck-entry-')) continue
      const candidate = await sessions.get(candidateId)
      if ((candidate?.data as { resourceLinkId?: unknown })?.resourceLinkId === ttlFallbackResourceId) {
        ttlFallbackEntryId = candidateId
        break
      }
    }
    assert.ok(ttlFallbackEntryId, 'expected a Learn entry mapping for the ttl-fallback resource')
    const ttlFallbackEntry = await sessions.get(ttlFallbackEntryId!)
    const ttlFallbackExpiresAt = (ttlFallbackEntry?.data as { expiresAt?: unknown })?.expiresAt
    assert.equal(typeof ttlFallbackExpiresAt, 'number')
    assert.ok(
      (ttlFallbackExpiresAt as number) >= beforeTtlFallbackStart + 4_242_000 && (ttlFallbackExpiresAt as number) <= Date.now() + 4_242_000,
      'active entry expiresAt should reflect valkeyStore.ttlMs, not fall back to the 10-minute waiting TTL',
    )
    const ttlFallbackLiveSession = await sessions.get((ttlFallbackEntry?.data as { activeSessionId?: unknown })?.activeSessionId as string)
    assert.equal(
      (ttlFallbackLiveSession?.data as { linkedSessionId?: unknown })?.linkedSessionId,
      ttlFallbackEntryId,
    )
    sessions.ttlMs = originalTtlMs

    console.info('[TEST] Verifying identity-fingerprint logs never leak raw resourceLinkId, sessionId, or handoff material.')
    const identityResolvedLogs = infoLogs.filter((message) => message.includes('"event":"learn-identity-resolved"'))
    assert.ok(identityResolvedLogs.length >= 5)
    for (const message of identityResolvedLogs) {
      assert.ok(!message.includes(resourceId))
      assert.ok(!message.includes(createdSessionId))
      assert.ok(!message.includes('waitingLaunchUrl'))
      assert.ok(!message.includes('instructorLaunchUrl'))
      assert.ok(!message.includes('browserToken'))
    }
  } finally {
    console.info = previousInfo
    console.error = previousError
    if (previousSecret === undefined) delete process.env.LEARN_SYNCDECK_HMAC_SECRET
    else process.env.LEARN_SYNCDECK_HMAC_SECRET = previousSecret
    if (previousKeyId === undefined) delete process.env.LEARN_SYNCDECK_HMAC_KEY_ID
    else process.env.LEARN_SYNCDECK_HMAC_KEY_ID = previousKeyId
  }
})
