import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import {
  findHashBySessionId,
  generatePersistentHash,
  resolvePersistentSessionSecret,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_COOKIE = 20
const MAX_TEACHER_CODE_LENGTH = 100
const HMAC_SECRET = resolvePersistentSessionSecret()

interface CookieSessionEntry {
  key: string
  teacherCode: string
  selectedOptions?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
}

interface SyncDeckRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface SyncDeckInstructorState {
  indices: { h: number; v: number; f: number } | null
  paused: boolean
  overview: boolean
  updatedAt: number
}

interface SyncDeckStudent {
  studentId: string
  name: string
  joinedAt: number
  lastSeenAt: number
  lastIndices: { h: number; v: number; f: number } | null
  lastStudentStateAt: number | null
}

interface SyncDeckEmbeddedActivity {
  embeddedId: string
  activityType: string
  sessionId: string | null
  slideIndex: { h: number; v: number } | null
  displayName: string
  createdAt: number
  status: 'planned' | 'active' | 'ended'
  startedAt: number | null
  endedAt: number | null
}

interface SyncDeckChalkboardBuffer {
  snapshot: string | null
  delta: Record<string, unknown>[]
}

interface SyncDeckSessionData extends Record<string, unknown> {
  presentationUrl: string | null
  instructorPasscode: string
  instructorState: SyncDeckInstructorState | null
  lastInstructorPayload: unknown
  chalkboard: SyncDeckChalkboardBuffer
  students: SyncDeckStudent[]
  embeddedActivities: SyncDeckEmbeddedActivity[]
}

interface SyncDeckSession extends SessionRecord {
  type?: string
  data: SyncDeckSessionData
}

interface SyncDeckSocket extends ActiveBitsWebSocket {
  isInstructor?: boolean
  sessionId?: string | null
  studentId?: string | null
  studentName?: string | null
}

interface SyncDeckWsMessage {
  type?: unknown
  payload?: unknown
}

const WS_OPEN_READY_STATE = 1
const SYNCDECK_WS_UPDATE_TYPE = 'syncdeck-state-update'
const SYNCDECK_WS_BROADCAST_TYPE = 'syncdeck-state'
const SYNCDECK_WS_STUDENTS_TYPE = 'syncdeck-students'
const REVEAL_SYNC_PROTOCOL_VERSION = '1.1.0'

type ChalkboardCommandName = 'chalkboardStroke' | 'chalkboardState' | 'clearChalkboard' | 'resetChalkboard'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createInstructorPasscode(): string {
  return randomBytes(16).toString('hex')
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeNullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeSlideIndices(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = normalizeNullableFiniteNumber(value.h)
  const v = normalizeNullableFiniteNumber(value.v)
  const f = normalizeNullableFiniteNumber(value.f)
  if (h == null || v == null || f == null) {
    return null
  }

  return { h, v, f }
}

function normalizeEmbeddedSlideIndex(value: unknown): { h: number; v: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = normalizeNullableFiniteNumber(value.h)
  const v = normalizeNullableFiniteNumber(value.v)
  if (h == null || v == null) {
    return null
  }

  return { h, v }
}

function normalizeStudentEntry(value: unknown): SyncDeckStudent | null {
  if (!isPlainObject(value)) {
    return null
  }

  const studentId = normalizeStudentId(value.studentId)
  if (!studentId) {
    return null
  }

  const now = Date.now()
  const joinedAt = normalizeFiniteNumber(value.joinedAt, now)
  const lastSeenAt = normalizeFiniteNumber(value.lastSeenAt, joinedAt)

  return {
    studentId,
    name: normalizeStudentName(value.name),
    joinedAt,
    lastSeenAt,
    lastIndices: normalizeSlideIndices(value.lastIndices),
    lastStudentStateAt: normalizeNullableFiniteNumber(value.lastStudentStateAt),
  }
}

function normalizeEmbeddedActivityEntry(value: unknown): SyncDeckEmbeddedActivity | null {
  if (!isPlainObject(value)) {
    return null
  }

  const embeddedId = typeof value.embeddedId === 'string' ? value.embeddedId.trim() : ''
  if (embeddedId.length === 0) {
    return null
  }

  const activityType = typeof value.activityType === 'string' && value.activityType.trim().length > 0 ? value.activityType.trim() : 'unknown'
  const displayName = typeof value.displayName === 'string' && value.displayName.trim().length > 0 ? value.displayName.trim() : activityType
  const status = value.status === 'active' || value.status === 'ended' || value.status === 'planned' ? value.status : 'planned'

  return {
    embeddedId,
    activityType,
    sessionId: typeof value.sessionId === 'string' && value.sessionId.trim().length > 0 ? value.sessionId.trim() : null,
    slideIndex: normalizeEmbeddedSlideIndex(value.slideIndex),
    displayName,
    createdAt: normalizeFiniteNumber(value.createdAt, Date.now()),
    status,
    startedAt: normalizeNullableFiniteNumber(value.startedAt),
    endedAt: normalizeNullableFiniteNumber(value.endedAt),
  }
}

function normalizeStudents(value: unknown): SyncDeckStudent[] {
  if (!Array.isArray(value)) {
    return []
  }

  const students: SyncDeckStudent[] = []
  for (const entry of value) {
    const normalized = normalizeStudentEntry(entry)
    if (normalized) {
      students.push(normalized)
    }
  }

  return students
}

function normalizeEmbeddedActivities(value: unknown): SyncDeckEmbeddedActivity[] {
  if (!Array.isArray(value)) {
    return []
  }

  const activities: SyncDeckEmbeddedActivity[] = []
  for (const entry of value) {
    const normalized = normalizeEmbeddedActivityEntry(entry)
    if (normalized) {
      activities.push(normalized)
    }
  }

  return activities
}

function normalizeChalkboardSnapshot(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  return value
}

function normalizeChalkboardDelta(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }

  const delta: Record<string, unknown>[] = []
  for (const entry of value) {
    if (isPlainObject(entry)) {
      delta.push(entry)
    }
  }

  return delta
}

function normalizeChalkboardBuffer(value: unknown): SyncDeckChalkboardBuffer {
  if (!isPlainObject(value)) {
    return {
      snapshot: null,
      delta: [],
    }
  }

  return {
    snapshot: normalizeChalkboardSnapshot(value.snapshot),
    delta: normalizeChalkboardDelta(value.delta),
  }
}

function normalizeSessionData(data: unknown): SyncDeckSessionData {
  const source = isPlainObject(data) ? data : {}

  return {
    presentationUrl: typeof source.presentationUrl === 'string' ? source.presentationUrl : null,
    instructorPasscode:
      typeof source.instructorPasscode === 'string' && source.instructorPasscode.length > 0
        ? source.instructorPasscode
        : createInstructorPasscode(),
    instructorState: null,
    lastInstructorPayload: source.lastInstructorPayload ?? null,
    chalkboard: normalizeChalkboardBuffer(source.chalkboard),
    students: normalizeStudents(source.students),
    embeddedActivities: normalizeEmbeddedActivities(source.embeddedActivities),
  }
}

function toChalkboardCommandName(value: unknown): ChalkboardCommandName | null {
  if (value === 'chalkboardStroke' || value === 'chalkboardState' || value === 'clearChalkboard' || value === 'resetChalkboard') {
    return value
  }

  return null
}

function parseChalkboardCommand(payload: unknown): { name: ChalkboardCommandName; payload: Record<string, unknown> } | null {
  if (!isPlainObject(payload)) {
    return null
  }

  const revealAction = toChalkboardCommandName(payload.action)
  if (revealAction) {
    return {
      name: revealAction,
      payload: isPlainObject(payload.payload) ? payload.payload : {},
    }
  }

  if (payload.action === 'command' && isPlainObject(payload.payload)) {
    const commandPayload = payload.payload
    const commandName = toChalkboardCommandName(commandPayload.name)
    if (!commandName) {
      return null
    }

    return {
      name: commandName,
      payload: isPlainObject(commandPayload.payload) ? commandPayload.payload : {},
    }
  }

  const topLevelCommandName = toChalkboardCommandName(payload.name)
  if (!topLevelCommandName) {
    return null
  }

  return {
    name: topLevelCommandName,
    payload: isPlainObject(payload.payload) ? payload.payload : {},
  }
}

function applyChalkboardBufferUpdate(sessionData: SyncDeckSessionData, payload: unknown): void {
  const command = parseChalkboardCommand(payload)
  if (!command) {
    return
  }

  if (command.name === 'chalkboardState') {
    sessionData.chalkboard.snapshot = typeof command.payload.storage === 'string' ? command.payload.storage : null
    sessionData.chalkboard.delta = []
    return
  }

  if (command.name === 'chalkboardStroke') {
    sessionData.chalkboard.delta.push(command.payload)
    return
  }

  if (command.name === 'clearChalkboard' || command.name === 'resetChalkboard') {
    sessionData.chalkboard.snapshot = null
    sessionData.chalkboard.delta = []
  }
}

function createRevealCommandEnvelope(name: 'chalkboardStroke' | 'chalkboardState', payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: REVEAL_SYNC_PROTOCOL_VERSION,
    action: 'command',
    deckId: null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: Date.now(),
    payload: {
      name,
      payload,
    },
  }
}

function sendBufferedChalkboardState(socket: ActiveBitsWebSocket, chalkboard: SyncDeckChalkboardBuffer): void {
  if (chalkboard.snapshot != null) {
    sendSyncDeckState(socket, createRevealCommandEnvelope('chalkboardState', { storage: chalkboard.snapshot }))
  }

  for (const strokePayload of chalkboard.delta) {
    sendSyncDeckState(socket, createRevealCommandEnvelope('chalkboardStroke', strokePayload))
  }
}

function parseWsMessage(raw: unknown): SyncDeckWsMessage | null {
  try {
    const text =
      typeof raw === 'string'
        ? raw
        : raw instanceof Buffer
          ? raw.toString('utf8')
          : Buffer.isBuffer(raw)
            ? raw.toString('utf8')
            : String(raw)
    const parsed = JSON.parse(text) as unknown
    return isPlainObject(parsed) ? (parsed as SyncDeckWsMessage) : null
  } catch {
    return null
  }
}

function sendSyncDeckState(socket: ActiveBitsWebSocket, payload: unknown): void {
  if (socket.readyState !== WS_OPEN_READY_STATE) {
    return
  }

  try {
    socket.send(
      JSON.stringify({
        type: SYNCDECK_WS_BROADCAST_TYPE,
        payload,
      }),
    )
  } catch {
    // Ignore socket send failures.
  }
}

function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 80) {
    return null
  }

  return trimmed
}

function normalizeStudentName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Student'
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Student'
  }

  return trimmed.slice(0, 80)
}

function asSyncDeckSession(session: SessionRecord | null): SyncDeckSession | null {
  if (!session || session.type !== 'syncdeck') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as SyncDeckSession
}

function readStringField(payload: unknown, key: string): string | null {
  if (!isPlainObject(payload)) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function toSelectedOptions(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function parsePersistentSessionsCookie(cookieValue: unknown): CookieSessionEntry[] {
  if (cookieValue == null) {
    return []
  }

  let parsedCookie: unknown
  try {
    parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue
  } catch {
    return []
  }

  if (!Array.isArray(parsedCookie)) {
    return []
  }

  return parsedCookie
    .filter(
      (entry): entry is Record<string, unknown> =>
        isPlainObject(entry) && typeof entry.key === 'string' && typeof entry.teacherCode === 'string',
    )
    .map((entry) => ({
      key: String(entry.key),
      teacherCode: entry.teacherCode as string,
      selectedOptions: toSelectedOptions(entry.selectedOptions),
    }))
}

function validatePresentationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function verifyInstructorPasscode(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const candidateBuffer = Buffer.from(candidate, 'utf8')
  if (expectedBuffer.length !== candidateBuffer.length) {
    return false
  }

  try {
    return timingSafeEqual(expectedBuffer, candidateBuffer)
  } catch {
    return false
  }
}

function computeUrlHash(persistentHash: string, presentationUrl: string): string {
  return createHmac('sha256', HMAC_SECRET).update(`${persistentHash}|${presentationUrl}`).digest('hex').substring(0, 16)
}

function verifyUrlHash(persistentHash: string, presentationUrl: string, candidate: string): boolean {
  if (candidate.length !== 16) {
    return false
  }

  const expected = computeUrlHash(persistentHash, presentationUrl)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'))
  } catch {
    return false
  }
}

registerSessionNormalizer('syncdeck', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupSyncDeckRoutes(app: SyncDeckRouteApp, sessions: SessionStore, ws: WsRouter): void {
  const broadcastStudentsToInstructors = async (sessionId: string): Promise<void> => {
    const session = asSyncDeckSession(await sessions.get(sessionId))
    if (!session) {
      return
    }

    const connectedStudentIds = new Set<string>()
    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (
        peer.readyState === WS_OPEN_READY_STATE &&
        peer.sessionId === session.id &&
        !peer.isInstructor &&
        typeof peer.studentId === 'string'
      ) {
        connectedStudentIds.add(peer.studentId)
      }
    }

    const payload = {
      students: session.data.students.map((student) => ({
        studentId: student.studentId,
        name: student.name,
        joinedAt: student.joinedAt,
        lastSeenAt: student.lastSeenAt,
        connected: connectedStudentIds.has(student.studentId),
      })),
      connectedCount: connectedStudentIds.size,
    }

    const serialized = JSON.stringify({
      type: SYNCDECK_WS_STUDENTS_TYPE,
      payload,
    })

    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (peer.readyState !== WS_OPEN_READY_STATE || peer.sessionId !== session.id || !peer.isInstructor) {
        continue
      }
      try {
        peer.send(serialized)
      } catch {
        // Ignore socket send failures.
      }
    }
  }

  app.get('/api/syncdeck/:sessionId/instructor-passcode', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asSyncDeckSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const persistentHash = await findHashBySessionId(sessionId)
    if (!persistentHash) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const sessionEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
    const matchingEntry = sessionEntries.find((entry) => entry.key === `syncdeck:${persistentHash}`)
    if (!matchingEntry) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const verifiedTeacherCode = verifyTeacherCodeWithHash('syncdeck', persistentHash, matchingEntry.teacherCode)
    if (!verifiedTeacherCode.valid) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    res.json({ instructorPasscode: session.data.instructorPasscode })
  })

  app.post('/api/syncdeck/generate-url', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const activityName = readStringField(body, 'activityName')
    const teacherCode = readStringField(body, 'teacherCode')
    const selectedOptions = toSelectedOptions(body.selectedOptions)
    const presentationUrl = typeof selectedOptions.presentationUrl === 'string' ? selectedOptions.presentationUrl : null

    if (activityName !== 'syncdeck' || !teacherCode) {
      res.status(400).json({ error: 'Missing or invalid activityName or teacherCode' })
      return
    }

    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'Teacher code must be at least 6 characters' })
      return
    }

    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` })
      return
    }

    if (!presentationUrl || !validatePresentationUrl(presentationUrl)) {
      res.status(400).json({ error: 'presentationUrl must be a valid http(s) URL' })
      return
    }

    const { hash } = generatePersistentHash('syncdeck', teacherCode)
    const urlHash = computeUrlHash(hash, presentationUrl)

    const cookieName = 'persistent_sessions'
    let sessionEntries = parsePersistentSessionsCookie(req.cookies?.[cookieName])
    const cookieKey = `syncdeck:${hash}`
    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }

    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      selectedOptions: { presentationUrl },
    })

    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE)
    }

    res.cookie?.(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })

    const params = new URLSearchParams({
      presentationUrl,
      urlHash,
    })

    res.json({
      hash,
      url: `/activity/syncdeck/${hash}?${params.toString()}`,
    })
  })

  app.post('/api/syncdeck/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'syncdeck'
    session.data = normalizeSessionData(session.data)
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ id: session.id, instructorPasscode: session.data.instructorPasscode })
  })

  app.post('/api/syncdeck/:sessionId/register-student', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asSyncDeckSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const name = normalizeStudentName(readStringField(req.body, 'name'))
    const studentId = randomBytes(8).toString('hex')
    const now = Date.now()

    session.data.students.push({
      studentId,
      name,
      joinedAt: now,
      lastSeenAt: now,
      lastIndices: null,
      lastStudentStateAt: null,
    })
    await sessions.set(session.id, session)
    await broadcastStudentsToInstructors(session.id)

    const response = res as unknown as JsonResponse
    response.json({ studentId, name })
  })

  app.post('/api/syncdeck/:sessionId/configure', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asSyncDeckSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const presentationUrl = readStringField(req.body, 'presentationUrl')
    const instructorPasscode = readStringField(req.body, 'instructorPasscode')
    const urlHash = readStringField(req.body, 'urlHash')
    const persistentHashFromClient = readStringField(req.body, 'persistentHash')
    if (
      !presentationUrl ||
      !validatePresentationUrl(presentationUrl) ||
      !instructorPasscode ||
      !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)
    ) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'invalid payload' })
      return
    }

    if (persistentHashFromClient) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'persistentHash must not be provided by client' })
      return
    }

    if (urlHash) {
      const persistentHash = await findHashBySessionId(sessionId)
      if (!persistentHash) {
        const response = res as unknown as JsonResponse
        response.status(400).json({ error: 'invalid payload' })
        return
      }

      if (!verifyUrlHash(persistentHash, presentationUrl, urlHash)) {
        const response = res as unknown as JsonResponse
        response.status(400).json({ error: 'invalid payload' })
        return
      }
    }

    session.data.presentationUrl = presentationUrl
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ ok: true })
  })

  ws.register('/ws/syncdeck', (socket, query) => {
    const client = socket as SyncDeckSocket
    client.sessionId = query.get('sessionId')
    client.isInstructor = false
    client.studentId = normalizeStudentId(query.get('studentId'))
    client.studentName = normalizeStudentName(query.get('studentName'))

    const sessionId = client.sessionId
    if (!sessionId) {
      socket.close(1008, 'missing sessionId')
      return
    }

    const role = query.get('role')
    const instructorPasscode = query.get('instructorPasscode')

    ;(async () => {
      const session = asSyncDeckSession(await sessions.get(sessionId))
      if (!session) {
        socket.close(1008, 'invalid session')
        return
      }

      if (role === 'instructor') {
        if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
          socket.close(1008, 'forbidden')
          return
        }
        client.isInstructor = true
        await broadcastStudentsToInstructors(session.id)
        return
      }

      if (client.studentId) {
        const now = Date.now()
        const existingStudent = session.data.students.find((student) => student.studentId === client.studentId)
        if (existingStudent) {
          existingStudent.lastSeenAt = now
          existingStudent.name = client.studentName ?? existingStudent.name
        } else {
          session.data.students.push({
            studentId: client.studentId,
            name: client.studentName ?? 'Student',
            joinedAt: now,
            lastSeenAt: now,
            lastIndices: null,
            lastStudentStateAt: null,
          })
        }
        await sessions.set(session.id, session)
      }

      if (session.data.lastInstructorPayload != null) {
        if (!parseChalkboardCommand(session.data.lastInstructorPayload)) {
          sendSyncDeckState(socket, session.data.lastInstructorPayload)
        }
      }

      sendBufferedChalkboardState(socket, session.data.chalkboard)

      await broadcastStudentsToInstructors(session.id)
    })().catch(() => {
      socket.close(1011, 'syncdeck initialization failed')
    })

    socket.on('message', (raw: unknown) => {
      void (async () => {
        if (!client.isInstructor || !client.sessionId) {
          return
        }

        const message = parseWsMessage(raw)
        if (!message || message.type !== SYNCDECK_WS_UPDATE_TYPE) {
          return
        }

        const session = asSyncDeckSession(await sessions.get(client.sessionId))
        if (!session) {
          return
        }

        session.data.lastInstructorPayload = message.payload ?? null
        applyChalkboardBufferUpdate(session.data, message.payload)
        await sessions.set(session.id, session)

        for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
          if (peer.sessionId !== session.id || peer.isInstructor || peer === client) {
            continue
          }
          sendSyncDeckState(peer, message.payload ?? null)
        }
      })().catch(() => {
        return
      })
    })

    socket.on('close', () => {
      if (!client.sessionId) {
        return
      }

      void broadcastStudentsToInstructors(client.sessionId)
    })
  })
}
