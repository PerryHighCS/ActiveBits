import {
  getOrCreateActivePersistentSession,
  getPersistentSession,
  addWaiter,
  removeWaiter,
  getWaiterCount,
  getWaiters,
  canAttemptTeacherCode,
  recordTeacherCodeAttempt,
  verifyTeacherCodeWithHash,
  startPersistentSession,
  isSessionStarted,
  getSessionId,
} from './persistentSessions.js'
import { createSession } from './sessions.js'
import type { SessionStore as CoreSessionStore } from './sessions.js'

const OPEN_SOCKET_STATE = 1
const MAX_TEACHER_CODE_LENGTH = 100

interface PersistentSessionSocket {
  id?: string
  sessionId?: string | null
  clientIp?: string
  persistentHash?: string
  readyState: number
  send(payload: string): void
  close(code?: number, reason?: string): void
  on(event: 'message' | 'close', handler: (payload?: unknown) => void): void
}

type SessionStore = Pick<CoreSessionStore, 'get' | 'set'>

interface WsRouter {
  register(
    pathname: string,
    handler: (socket: PersistentSessionSocket, query: URLSearchParams, _wss: unknown) => void,
  ): void
}

interface IncomingPersistentMessage {
  type?: string
  teacherCode?: unknown
}

/**
 * Setup WebSocket handlers for persistent session waiting rooms.
 */
export function setupPersistentSessionWs(ws: WsRouter, sessions: SessionStore): void {
  ws.register('/ws/persistent-session', (socket, queryParams) => {
    const hash = queryParams.get('hash') || null
    const activityName = queryParams.get('activityName') || null

    if (!hash || !activityName) {
      socket.close(1008, 'Missing hash or activityName')
      return
    }

    ;(async () => {
      const session = await getOrCreateActivePersistentSession(activityName, hash)

      socket.persistentHash = hash

      if (await isSessionStarted(hash)) {
        socket.send(
          JSON.stringify({
            type: 'session-started',
            sessionId: await getSessionId(hash),
          }),
        )
        socket.close(1000, 'Session already started')
        return
      }

      const waiterCount = addWaiter(hash, socket)
      await broadcastWaiterCount(hash, session)

      console.log(`Waiter joined persistent session ${hash}, total waiters: ${waiterCount}`)
    })().catch((err) => {
      console.error('Error in persistent session setup:', err)
    })

    socket.on('message', (data) => {
      try {
        const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : String(data || '')
        const message = JSON.parse(raw) as IncomingPersistentMessage

        if (message.type === 'verify-teacher-code') {
          const teacherCode = typeof message.teacherCode === 'string' ? message.teacherCode : ''
          void handleTeacherCodeVerification(socket, hash, teacherCode, sessions)
        }
      } catch (err) {
        console.error('Error handling persistent session message:', err)
      }
    })

    socket.on('close', () => {
      ;(async () => {
        const wasRemoved = removeWaiter(hash, socket)
        if (wasRemoved) {
          const session = await getPersistentSession(hash)
          await broadcastWaiterCount(hash, session)
          console.log(`Waiter left persistent session ${hash}`)
        }
      })().catch((err) => {
        console.error('Error in waiter cleanup:', err)
      })
    })
  })
}

async function handleTeacherCodeVerification(
  socket: PersistentSessionSocket,
  hash: string,
  teacherCode: string,
  sessions: SessionStore,
): Promise<void> {
  if (!teacherCode || typeof teacherCode !== 'string') {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Invalid teacher code format',
      }),
    )
    return
  }

  if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Teacher code too long',
      }),
    )
    return
  }

  const clientIp = socket.clientIp || 'unknown'
  const rateLimitKey = `${clientIp}:${hash}`

  if (!(await canAttemptTeacherCode(rateLimitKey))) {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Too many attempts. Please wait a minute.',
      }),
    )
    return
  }

  await recordTeacherCodeAttempt(rateLimitKey)

  const persistentSession = await getPersistentSession(hash)
  if (!persistentSession) {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Session not found',
      }),
    )
    return
  }

  const validation = verifyTeacherCodeWithHash(persistentSession.activityName, hash, teacherCode)

  if (!validation.valid) {
    const logMessage = `Teacher code validation failed for hash ${hash}, activity ${persistentSession.activityName}`
    if (process.env.NODE_ENV?.startsWith('dev')) {
      console.log(`${logMessage}: ${validation.error}`)
    } else {
      console.log(logMessage)
    }
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: validation.error,
      }),
    )
    return
  }

  const newSession = await createSession(sessions, { data: {} })
  newSession.type = persistentSession.activityName
  await sessions.set(newSession.id, newSession)

  console.log(`Created session ${newSession.id} for persistent session ${hash}`)

  const waiters = await startPersistentSession(hash, newSession.id, socket)
  removeWaiter(hash, socket)

  socket.send(
    JSON.stringify({
      type: 'teacher-authenticated',
      sessionId: newSession.id,
    }),
  )

  for (const waiter of waiters) {
    if (waiter !== socket && waiter.readyState === OPEN_SOCKET_STATE) {
      waiter.send(
        JSON.stringify({
          type: 'session-started',
          sessionId: newSession.id,
        }),
      )
    }
  }

  console.log(`Started persistent session ${hash} -> ${newSession.id}, notified ${waiters.length - 1} student waiters`)
}

async function broadcastWaiterCount(
  hash: string,
  session: { activityName: string } | null,
): Promise<void> {
  if (!session) return

  const count = getWaiterCount(hash)
  const message = JSON.stringify({
    type: 'waiter-count',
    count,
  })

  const waiters = getWaiters(hash)
  for (const waiter of waiters) {
    if (waiter.readyState === OPEN_SOCKET_STATE) {
      waiter.send(message)
    }
  }
}
