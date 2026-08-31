import {
  getOrCreateActivePersistentSession,
  getPersistentSession,
  addWaiter,
  removeWaiter,
  getWaiterCount,
  getWaiters,
  recordTeacherCodeAttempt,
  verifyTeacherCodeWithHash,
  startPersistentSession,
  rollbackPersistentSessionStart,
  isSessionStarted,
  getSessionId,
} from './persistentSessions.js'
import { createSession } from './sessions.js'
import type { SessionStore as CoreSessionStore } from './sessions.js'
import { buildCreateSessionBootstrapPayload } from './createSessionBootstrapPayload.js'
import { buildSoloOnlyPolicyRejection } from './persistentSessionPolicyUtils.js'
import { getActivityConfig } from '../activities/activityRegistry.js'
import { normalizePossiblyEncodedHttpUrl } from './httpUrlUtils.js'

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

type SessionStore = Pick<CoreSessionStore, 'get' | 'set'> & Partial<Pick<CoreSessionStore, 'delete'>>

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

function getSelectedOptionSessionDataValue(
  key: string,
  value: unknown,
  deepLinkOptions: Record<string, { validator?: unknown }> | null,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const deepLinkOption = deepLinkOptions?.[key] ?? null

  if (deepLinkOption?.validator === 'url') {
    return normalizePossiblyEncodedHttpUrl(trimmed)
  }

  return trimmed
}

function buildPersistentSessionData(
  activityName: string,
  selectedOptions: Record<string, unknown>,
): Record<string, unknown> {
  const newSessionData: Record<string, unknown> = {}
  const selectedOptionKeys = Object.keys(selectedOptions)
  if (selectedOptionKeys.length === 0) {
    return newSessionData
  }

  const activityConfig = getActivityConfig(activityName)
  const deepLinkOptions = (
    activityConfig?.deepLinkOptions != null
    && typeof activityConfig.deepLinkOptions === 'object'
    && !Array.isArray(activityConfig.deepLinkOptions)
  )
    ? activityConfig.deepLinkOptions as Record<string, { validator?: unknown }>
    : null
  const createSessionBootstrap = (
    activityConfig?.createSessionBootstrap != null
    && typeof activityConfig.createSessionBootstrap === 'object'
    && !Array.isArray(activityConfig.createSessionBootstrap)
  )
    ? activityConfig.createSessionBootstrap as { selectedOptionsToSessionData?: unknown }
    : null
  const topLevelSelectedOptionKeys = Array.isArray(createSessionBootstrap?.selectedOptionsToSessionData)
    ? createSessionBootstrap.selectedOptionsToSessionData.filter((entry): entry is string => typeof entry === 'string')
    : []

  for (const key of topLevelSelectedOptionKeys) {
    const normalizedValue = getSelectedOptionSessionDataValue(key, selectedOptions[key], deepLinkOptions)
    if (normalizedValue != null) {
      newSessionData[key] = normalizedValue
    }
  }

  newSessionData.embeddedLaunch = {
    selectedOptions: { ...selectedOptions },
  }
  return newSessionData
}

/**
 * Setup WebSocket handlers for persistent session waiting rooms.
 */
export function setupPersistentSessionWs(ws: WsRouter, sessions: SessionStore): void {
  ws.register('/ws/persistent-session', (socket, queryParams) => {
    const hash = queryParams.get('hash') ?? null
    const activityName = queryParams.get('activityName') ?? null

    if (hash == null || activityName == null) {
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
        const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : String(data ?? '')
        const message = JSON.parse(raw) as IncomingPersistentMessage

        if (message.type === 'verify-teacher-code') {
          const teacherCode = typeof message.teacherCode === 'string' ? message.teacherCode : ''
          void handleTeacherCodeVerification(socket, hash, teacherCode, sessions).catch((err) => {
            // Backstop: handleTeacherCodeVerification handles its own known
            // failure paths, but a rejection must never escape as an unhandled
            // promise rejection at this message boundary.
            console.error(JSON.stringify({
              event: 'persistent-session.teacher-verification-unhandled',
              hash,
              error: err instanceof Error ? err.message : String(err),
            }))
            try {
              socket.send(JSON.stringify({
                type: 'teacher-code-error',
                error: 'Teacher verification failed. Please try again.',
              }))
            } catch {
              // Socket already closed; nothing to report to.
            }
          })
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
  if (teacherCode == null || typeof teacherCode !== 'string') {
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

  const clientIp = socket.clientIp ?? 'unknown'
  const rateLimitKey = `${clientIp}:${hash}`

  const attemptResult = await recordTeacherCodeAttempt(rateLimitKey)
  if (!attemptResult.allowed) {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Too many attempts. Please wait a minute.',
      }),
    )
    return
  }

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

  if (persistentSession.entryPolicy === 'solo-only') {
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        ...buildSoloOnlyPolicyRejection(),
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

  const selectedOptions = persistentSession.selectedOptions != null
    ? { ...persistentSession.selectedOptions }
    : {}
  const newSessionData = buildPersistentSessionData(persistentSession.activityName, selectedOptions)

  const newSession = await createSession(sessions, {
    data: newSessionData,
  })
  newSession.type = persistentSession.activityName
  await sessions.set(newSession.id, newSession)
  const createSessionPayload = buildCreateSessionBootstrapPayload(persistentSession.activityName, newSession.data)

  console.log(`Created session ${newSession.id} for persistent session ${hash}`)

  let waiters: Awaited<ReturnType<typeof startPersistentSession>>
  try {
    waiters = await startPersistentSession(hash, newSession.id, socket)
  } catch (err) {
    // The live session was created but could not be linked to its persistent
    // record (e.g. the reverse-index write rejected). Roll the orphan back and
    // surface a retryable error instead of leaking an unhandled rejection.
    console.error(JSON.stringify({
      event: 'persistent-session.start-failed-after-create',
      hash,
      sessionId: newSession.id,
      error: err instanceof Error ? err.message : String(err),
    }))
    try {
      await sessions.delete?.(newSession.id)
    } catch (cleanupErr) {
      console.error(JSON.stringify({
        event: 'persistent-session.start-failed-cleanup-failed',
        hash,
        sessionId: newSession.id,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      }))
    }
    // startPersistentSession may have persisted `sessionId` on the persistent
    // record before its reverse-index write failed. Clear that so the next
    // waiter is not told `session-started` with this now-deleted id and can
    // still retry teacher verification.
    await rollbackPersistentSessionStart(hash)
    socket.send(
      JSON.stringify({
        type: 'teacher-code-error',
        error: 'Session start is temporarily unavailable. Please try again.',
      }),
    )
    return
  }
  removeWaiter(hash, socket)

  socket.send(
    JSON.stringify({
      type: 'teacher-authenticated',
      sessionId: newSession.id,
      ...(createSessionPayload ? { createSessionPayload } : {}),
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
