import crypto from 'node:crypto'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import type { WsRouter } from '../../../../types/websocket.js'
import type {
  TravelingSalesmanSession,
  TravelingSalesmanSessionStore,
  TravelingSalesmanSocket,
  TravelingSalesmanStudent,
} from '../../travelingSalesmanTypes.js'
import { asTravelingSalesmanSession } from '../../travelingSalesmanTypes.js'

interface BroadcastRouteRecord {
  id: string
  name: string
  type: string
  distance: number | null
  path?: string[]
  timeToComplete?: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
  status?: string
}

/**
 * Generate unique student ID
 */
export function generateStudentId(_name: string): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const timestamp = Date.now().toString(36)
  const random = crypto.randomBytes(8).toString('hex')
  return `${timestamp}-${random}`
}

/**
 * Close duplicate WebSocket connections for same student
 */
export function closeDuplicateStudentSockets(ws: WsRouter, currentSocket: TravelingSalesmanSocket): void {
  if (!currentSocket.sessionId || !currentSocket.studentId) return

  for (const client of ws.wss.clients as Set<TravelingSalesmanSocket>) {
    if (
      client !== currentSocket &&
      client.readyState === 1 &&
      client.sessionId === currentSocket.sessionId &&
      client.studentId === currentSocket.studentId
    ) {
      client.ignoreDisconnect = true
      try {
        client.close(4000, 'Replaced by new connection')
      } catch (err) {
        console.error('Failed to close duplicate socket:', err)
      }
    }
  }
}

export function createBroadcastHelpers(sessions: TravelingSalesmanSessionStore, ws: WsRouter) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  const broadcast = async (type: string, payload: unknown, sessionId: string): Promise<void> => {
    const message = { type, payload }
    const serialized = JSON.stringify(message)
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, message)
    }
    for (const socket of ws.wss.clients) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(serialized)
        } catch (err) {
          console.error('Broadcast error:', err)
        }
      }
    }
  }

  const buildBroadcastPayload = (session: TravelingSalesmanSession): BroadcastRouteRecord[] => {
    const routes: BroadcastRouteRecord[] = []
    const ids = session.data.broadcasts

    const instructor = session.data.instructor
    const instructorRoute = instructor?.route
    if (ids.includes('instructor') && instructor != null && (instructorRoute?.length ?? 0) > 0) {
      routes.push({
        id: 'instructor',
        name: instructor.name || 'Instructor',
        path: instructorRoute,
        distance: instructor.distance ?? null,
        type: 'instructor',
        timeToComplete: instructor.timeToComplete ?? null,
      })
    }

    if (ids.includes('heuristic') && session.data.algorithms.heuristic?.computed) {
      routes.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        path: session.data.algorithms.heuristic.route,
        distance: session.data.algorithms.heuristic.distance ?? null,
        type: 'heuristic',
        timeToComplete: session.data.algorithms.heuristic.computeTime ?? null,
      })
    }

    if (ids.includes('bruteforce')) {
      if (session.data.algorithms.bruteForce?.computed) {
        routes.push({
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          path: session.data.algorithms.bruteForce.route,
          distance: session.data.algorithms.bruteForce.distance ?? null,
          type: 'bruteforce',
          timeToComplete: session.data.algorithms.bruteForce.computeTime ?? null,
        })
      } else if (session.data.algorithms.bruteForce?.status) {
        routes.push({
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          distance: null,
          type: 'bruteforce',
          progressCurrent: session.data.algorithms.bruteForce.progressCurrent ?? null,
          progressTotal: session.data.algorithms.bruteForce.progressTotal ?? null,
          status: session.data.algorithms.bruteForce.status,
        })
      }
    }

    // Student routes (by id)
    ids.forEach((id) => {
      if (id === 'instructor' || id === 'heuristic' || id === 'bruteforce') return
      const student = session.data.students?.find((entry: TravelingSalesmanStudent) => entry.id === id)
      if (student && Array.isArray(student.currentRoute) && student.currentRoute.length > 0) {
        routes.push({
          id: student.id,
          name: student.name,
          path: student.currentRoute,
          distance: student.routeDistance,
          type: 'student',
          timeToComplete: student.timeToComplete ?? null,
        })
      }
    })

    return routes
  }

  const broadcastRoutesUpdate = async (session: TravelingSalesmanSession): Promise<void> => {
    const routes = buildBroadcastPayload(session)
    await broadcast('broadcastUpdate', { routes }, session.id)
    if (routes.length === 0) {
      await broadcast('clearBroadcast', { cleared: true }, session.id)
    }
  }

  const updateStudentStatus = async (
    sessionOrId: string | TravelingSalesmanSession,
    updater: (session: TravelingSalesmanSession) => boolean | Promise<boolean>,
  ): Promise<TravelingSalesmanSession | null> => {
    const session =
      typeof sessionOrId === 'string' ? asTravelingSalesmanSession(await sessions.get(sessionOrId)) : sessionOrId

    if (!session) return null

    const updated = await updater(session)
    if (!updated) return session

    await sessions.set(session.id, session)
    await broadcast('studentsUpdate', { students: session.data.students }, session.id)
    return session
  }

  return {
    ensureBroadcastSubscription,
    broadcast,
    buildBroadcastPayload,
    broadcastRoutesUpdate,
    updateStudentStatus,
  }
}
