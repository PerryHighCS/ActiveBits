import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { randomUUID } from 'node:crypto'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { connectAcceptedSessionParticipant } from 'activebits-server/core/acceptedSessionParticipants.js'
import { getSessionParticipantCookieName, resolveAcceptedEntryParticipantToken } from 'activebits-server/core/acceptedEntryParticipants.js'
import { DEFAULT_ACTIVITY_CAPABILITY_TTL_MS, getActivityCapabilityCookieName, issueActivityCapability, readCookieValue, resolveActivityPrincipalFromCookies } from 'activebits-server/core/activityCapabilities.js'
import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import { closeDuplicateParticipantSockets } from 'activebits-server/core/participantSockets.js'
import { disconnectSessionParticipant, updateSessionParticipant } from 'activebits-server/core/sessionParticipants.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  JavaFormatSessionData,
  JavaFormatStats,
  JavaFormatStudentRecord,
} from '../javaFormatPracticeTypes.js'
import { validateDifficulty, validateStats, validateStudentName, validateTheme } from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  cookie?(name: string, value: string, options: Record<string, unknown>): void
  setHeader?(name: string, value: string): void
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
}

interface JavaFormatRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface JavaFormatSocket extends ActiveBitsWebSocket {
  principalKind?: 'manager' | 'participant'
  studentName?: string | null
  studentId?: string | null
  ignoreDisconnect?: boolean
}

interface JavaFormatSession extends SessionRecord {
  type?: string
  data: JavaFormatSessionData
}

const defaultStats: JavaFormatStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStudentRecord(value: unknown): JavaFormatStudentRecord | null {
  if (!isPlainObject(value)) return null

  const name = validateStudentName(value.name)
  if (!name) return null

  const joined = typeof value.joined === 'number' ? value.joined : Date.now()
  const lastSeen = typeof value.lastSeen === 'number' ? value.lastSeen : joined
  const stats = validateStats(value.stats) ?? { ...defaultStats }

  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name,
    connected: Boolean(value.connected),
    joined,
    lastSeen,
    stats,
  }
}

function normalizeSessionData(data: unknown): JavaFormatSessionData {
  const source = isPlainObject(data) ? data : {}
  const students = Array.isArray(source.students)
    ? source.students
        .map((student) => normalizeStudentRecord(student))
        .filter((student): student is JavaFormatStudentRecord => Boolean(student))
    : []

  return {
    ...source,
    students,
    selectedDifficulty: validateDifficulty(source.selectedDifficulty),
    selectedTheme: validateTheme(source.selectedTheme),
  }
}

const MAX_SET_TIMEOUT_MS = 2_147_483_647

/**
 * Close an admitted manager socket once its capability reaches `expiresAt`. The
 * handshake rejects an already-expired token, but without this a connection that
 * stays open (kept alive by the shared heartbeat) would keep receiving private
 * roster updates past the bounded capability lifetime.
 */
function scheduleCapabilityExpiryClose(
  client: JavaFormatSocket,
  session: JavaFormatSession,
  capabilityId: string,
): void {
  const record = (session.data as { activityCapabilities?: Record<string, { expiresAt?: unknown }> })
    .activityCapabilities?.[capabilityId]
  const expiresAt = record?.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return

  const closeExpired = (): void => {
    try {
      client.close(1008, 'activity-auth-required')
    } catch {
      // socket already tearing down
    }
  }

  const ttl = expiresAt - Date.now()
  if (ttl <= 0) {
    closeExpired()
    return
  }
  const timer = setTimeout(closeExpired, Math.min(ttl, MAX_SET_TIMEOUT_MS))
  timer.unref?.()
  client.on('close', () => clearTimeout(timer))
}

function asJavaFormatSession(session: SessionRecord | null): JavaFormatSession | null {
  if (!session || session.type !== 'java-format-practice') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as JavaFormatSession
}

registerSessionNormalizer('java-format-practice', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupJavaFormatPracticeRoutes(
  app: JavaFormatRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const broadcastOrigin = randomUUID()
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws, (client, message) => {
    if (isPlainObject(message) && message.origin === broadcastOrigin) return false
    const audience = isPlainObject(message) ? message.audience : undefined
    // Fail closed: a cross-instance message without an explicit recognized
    // audience (e.g. from an older build during a rolling deploy) is not
    // forwarded, so a private `studentsUpdate` can never reach participant sockets.
    if (audience !== 'all' && audience !== 'manager') return false
    return audience === 'all' || (client as JavaFormatSocket).principalKind === 'manager'
  })

  async function broadcast(type: string, payload: unknown, sessionId: string, audience: 'all' | 'manager' = 'all'): Promise<void> {
    const message = JSON.stringify({ type, payload })

    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, {
        type,
        payload,
        audience,
        origin: broadcastOrigin,
      })
    }

    for (const socket of ws.wss.clients as Set<JavaFormatSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId && (audience === 'all' || socket.principalKind === audience)) {
        try {
          socket.send(message)
        } catch (error) {
          console.error('Failed to send to client:', error)
        }
      }
    }

  }

  ws.register('/ws/java-format-practice', (socket, query) => {
    const client = socket as JavaFormatSocket
    const requestedSessionId = query.get('sessionId') || null
    const requestedPrincipal = query.get('principal')

    if (!requestedSessionId) {
      // wsRouter has already upgraded and retained this socket; a request with no
      // session can never be admitted, so close it instead of leaving it idle.
      console.info(JSON.stringify({ event: 'java-format.websocket-denied', reason: 'missing-session-id' }))
      client.close(1008, 'activity-auth-required')
      return
    }

    if (requestedSessionId) {
      const activeSessionId = requestedSessionId

      ;(async () => {
        const session = asJavaFormatSession(await sessions.get(activeSessionId))
        if (!session) {
          console.info(JSON.stringify({
            event: 'java-format.websocket-denied',
            sessionId: activeSessionId,
            reason: 'unknown-session',
          }))
          client.close(1008, 'activity-auth-required')
          return
        }

        // The socket may have closed while the session lookup was in flight; the
        // close handler already ran (with no sessionId/studentId set), so bail
        // before retaining, subscribing, or writing a roster record for it.
        if (client.readyState !== 1) return

        const cookieHeader = client.upgradeHeaders?.cookie
        const manager = requestedPrincipal !== 'participant'
          ? resolveActivityPrincipalFromCookies(session, activeSessionId, 'manager', {
            [getActivityCapabilityCookieName('manager', activeSessionId)]: readCookieValue(cookieHeader, getActivityCapabilityCookieName('manager', activeSessionId)),
          })
          : null
        if (requestedPrincipal !== 'participant' && manager) {
          client.principalKind = 'manager'
          client.sessionId = activeSessionId
          ensureBroadcastSubscription(activeSessionId)
          scheduleCapabilityExpiryClose(client, session, manager.capabilityId)
          return
        }

        if (requestedPrincipal === 'manager') {
          console.info(JSON.stringify({
            event: 'java-format.websocket-denied',
            sessionId: activeSessionId,
            reason: 'missing-manager-principal',
          }))
          client.close(1008, 'activity-auth-required')
          return
        }

        const participantToken = readCookieValue(cookieHeader, getSessionParticipantCookieName(activeSessionId))
        const acceptedParticipant = resolveAcceptedEntryParticipantToken(session, participantToken)
        if (!acceptedParticipant) {
          console.info(JSON.stringify({
            event: 'java-format.websocket-denied',
            sessionId: activeSessionId,
            reason: 'missing-or-invalid-principal',
          }))
          client.close(1008, 'activity-auth-required')
          return
        }
        const result = connectAcceptedSessionParticipant({
          session,
          participants: session.data.students,
          participantId: acceptedParticipant.participantId,
          participantName: null,
          allowLegacyUnnamedMatch: false,
          createParticipant: (participantId, participantName, now) => ({
            id: participantId,
            name: participantName,
            connected: true,
            joined: now,
            lastSeen: now,
            stats: { ...defaultStats },
          }),
          generateParticipantId,
        })
        if (!result) {
          client.close(1008, 'activity-auth-required')
          return
        }
        client.principalKind = 'participant'
        client.sessionId = activeSessionId
        ensureBroadcastSubscription(activeSessionId)
        client.studentName = result.participantName
        const { participantId } = result
        client.studentId = participantId

        closeDuplicateParticipantSockets(ws.wss.clients as Set<JavaFormatSocket>, client)

        await sessions.set(session.id, session)
        await broadcast('studentsUpdate', { students: session.data.students }, session.id, 'manager')

        if (client.studentId) {
          client.send(JSON.stringify({ type: 'studentId', payload: { studentId: client.studentId } }))
        }
      })().catch((error) => {
        console.error(JSON.stringify({
          event: 'java-format.websocket-participant-join-failed',
          sessionId: activeSessionId,
          error: String(error),
        }))
        // Admission threw after the upgrade; don't leave an idle unauthenticated
        // socket open. A non-1008 close lets the resilient client retry.
        if (client.readyState === 1) {
          try {
            client.close(1011, 'activity-join-failed')
          } catch {
            // socket already tearing down
          }
        }
      })
    }

    client.on('close', () => {
      if (client.ignoreDisconnect || !client.sessionId || !client.studentId) return

      const activeSessionId = client.sessionId
      const activeStudentId = client.studentId
      ;(async () => {
        const session = asJavaFormatSession(await sessions.get(activeSessionId))
        if (!session) return

        const student = disconnectSessionParticipant({
          participants: session.data.students,
          participantId: activeStudentId,
        })
        if (!student) return

        await sessions.set(session.id, session)
        await broadcast('studentsUpdate', { students: session.data.students }, session.id, 'manager')
      })().catch((error) => console.error(JSON.stringify({
        event: 'java-format.websocket-participant-disconnect-failed',
        sessionId: activeSessionId,
        error: String(error),
      })))
    })
  })

  app.post('/api/java-format-practice/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'java-format-practice'
    session.data = normalizeSessionData(session.data)

    const managerCapability = issueActivityCapability(session, 'manager')
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    // This response mints a credential-bearing cookie; keep it out of every
    // cache the same way the participant-consume and private roster responses are.
    res.setHeader?.('Cache-Control', 'no-store')
    res.cookie?.(getActivityCapabilityCookieName('manager', session.id), managerCapability.token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: DEFAULT_ACTIVITY_CAPABILITY_TTL_MS,
    })
    res.json({ id: session.id })
  })

  app.get('/api/java-format-practice/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({
      sessionId: session.id,
      type: session.type,
      selectedDifficulty: session.data.selectedDifficulty,
      selectedTheme: session.data.selectedTheme,
    })
  })

  app.post('/api/java-format-practice/:sessionId/difficulty', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    if (!resolveActivityPrincipalFromCookies(session, sessionId, 'manager', req.cookies)) {
      console.warn(JSON.stringify({ event: 'java-format.manager-difficulty-denied', sessionId }))
      res.status(403).json({ error: 'manager authentication required' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const difficulty = validateDifficulty(body.difficulty)

    session.data.selectedDifficulty = difficulty
    await sessions.set(session.id, session)
    await broadcast('difficultyUpdate', { difficulty }, session.id)

    res.json({ success: true, difficulty })
  })

  app.post('/api/java-format-practice/:sessionId/theme', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    if (!resolveActivityPrincipalFromCookies(session, sessionId, 'manager', req.cookies)) {
      console.warn(JSON.stringify({ event: 'java-format.manager-theme-denied', sessionId }))
      res.status(403).json({ error: 'manager authentication required' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const theme = validateTheme(body.theme)

    session.data.selectedTheme = theme
    await sessions.set(session.id, session)
    await broadcast('themeUpdate', { theme }, session.id)

    res.json({ success: true, theme })
  })

  app.post('/api/java-format-practice/:sessionId/stats', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const acceptedParticipant = resolveAcceptedEntryParticipantToken(
      session,
      req.cookies?.[getSessionParticipantCookieName(sessionId)],
    )
    if (!acceptedParticipant) {
      res.status(403).json({ error: 'participant authentication required' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const stats = validateStats(body.stats)
    if (!stats) {
      res.status(400).json({ error: 'valid stats object required' })
      return
    }

    let student = updateSessionParticipant({
      participants: session.data.students,
      participantId: acceptedParticipant.participantId,
      participantName: null,
      allowLegacyUnnamedMatch: false,
      update: (participant) => {
        participant.stats = stats
      },
    })
    if (!student) {
      // The participant socket normally creates the roster record on admission,
      // but the client can POST stats before the socket connects (e.g. on
      // reload). Establish the record here so restored progress is not dropped.
      const established = connectAcceptedSessionParticipant({
        session,
        participants: session.data.students,
        participantId: acceptedParticipant.participantId,
        participantName: null,
        allowLegacyUnnamedMatch: false,
        createParticipant: (participantId, participantName, now) => ({
          id: participantId,
          name: participantName,
          connected: false,
          joined: now,
          lastSeen: now,
          stats: { ...defaultStats },
        }),
        generateParticipantId,
      })
      if (established) {
        established.participant.stats = stats
        student = established.participant
      }
    }
    if (student) {
      await sessions.set(session.id, session)
      await broadcast('studentsUpdate', { students: session.data.students }, session.id, 'manager')
    }

    res.json({ success: true })
  })

  app.get('/api/java-format-practice/:sessionId/students', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    if (!resolveActivityPrincipalFromCookies(session, sessionId, 'manager', req.cookies)) {
      console.warn(JSON.stringify({ event: 'java-format.manager-roster-denied', sessionId }))
      res.status(403).json({ error: 'manager authentication required' })
      return
    }
    res.setHeader?.('Cache-Control', 'no-store')
    res.json({ students: session.data.students })
  })
}
