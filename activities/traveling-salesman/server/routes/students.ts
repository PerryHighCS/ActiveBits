import type { WsRouter } from '../../../../types/websocket.js'
import type {
  TravelingSalesmanRouteApp,
  TravelingSalesmanSessionStore,
  TravelingSalesmanSocket,
} from '../../travelingSalesmanTypes.js'
import { asTravelingSalesmanSession } from '../../travelingSalesmanTypes.js'
import { isFiniteNumber, isRouteArray } from '../validation.js'
import { createBroadcastHelpers, closeDuplicateStudentSockets, generateStudentId } from './shared.js'

export default function registerStudentRoutes(
  app: TravelingSalesmanRouteApp,
  sessions: TravelingSalesmanSessionStore,
  ws: WsRouter,
): void {
  const { ensureBroadcastSubscription, broadcast, buildBroadcastPayload, updateStudentStatus } = createBroadcastHelpers(
    sessions,
    ws,
  )

  // WebSocket namespace
  ws.register('/ws/traveling-salesman', (socket, qp) => {
    const client = socket as TravelingSalesmanSocket
    client.sessionId = qp.get('sessionId') || null
    ensureBroadcastSubscription(client.sessionId)
    const studentName = qp.get('studentName') || null
    const studentId = qp.get('studentId') || null

    if (client.sessionId && studentName) {
      ;(async () => {
        const session = asTravelingSalesmanSession(await sessions.get(client.sessionId || ''))
        if (session) {
          const student = studentId
            ? session.data.students.find((entry) => entry.id === studentId)
            : session.data.students.find((entry) => entry.name === studentName)

          if (!student) {
            // New student
            const newId = generateStudentId(studentName)
            client.studentId = newId
            session.data.students.push({
              id: newId,
              name: studentName,
              connected: true,
              joined: Date.now(),
              lastSeen: Date.now(),
              currentRoute: [],
              routeDistance: 0,
              complete: false,
              attempts: 0,
              routeStartTime: null,
              routeCompleteTime: null,
              timeToComplete: null,
            })
          } else {
            // Reconnection
            client.studentId = student.id
            student.connected = true
            student.lastSeen = Date.now()
            closeDuplicateStudentSockets(ws, client)
          }

          await sessions.set(session.id, session)
          client.send(
            JSON.stringify({
              type: 'studentId',
              payload: { studentId: client.studentId },
            }),
          )

          // Send current problem if it exists
          if (session.data.problem != null) {
            client.send(
              JSON.stringify({
                type: 'problemUpdate',
                payload: {
                  cities: session.data.problem.cities,
                  distanceMatrix: session.data.problem.distanceMatrix,
                  seed: session.data.problem.seed,
                },
              }),
            )
          }

          if (session.data.broadcasts.length > 0) {
            const routes = buildBroadcastPayload(session)
            client.send(
              JSON.stringify({
                type: 'broadcastUpdate',
                payload: { routes },
              }),
            )
          }

          await broadcast('studentsUpdate', { students: session.data.students }, session.id)
        }
      })().catch((err) => {
        console.error('Failed to initialize traveling salesman session', err)
        try {
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: 'Failed to initialize session. Please refresh the page.' },
            }),
          )
        } catch (sendErr) {
          console.error('Failed to notify socket about initialization error', sendErr)
        }
      })
    }

    const handleDisconnect = async (): Promise<void> => {
      if (!client.sessionId || !client.studentId) return
      try {
        await updateStudentStatus(client.sessionId, (session) => {
          const student = session.data.students.find((entry) => entry.id === client.studentId)
          if (!student) return false
          student.connected = false
          student.lastSeen = Date.now()
          return true
        })
      } catch (err) {
        console.error('Failed to handle traveling salesman disconnect', err)
      }
    }

    client.on('close', handleDisconnect)
    client.on('error', handleDisconnect)
  })

  // Submit student route
  app.post('/api/traveling-salesman/:sessionId/submit-route', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const session = asTravelingSalesmanSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const studentId = body.studentId
    const route = body.route
    const distance = body.distance
    const timeToComplete = body.timeToComplete

    if (typeof studentId !== 'string' || !studentId.trim()) {
      res.status(400).json({ error: 'Invalid studentId' })
      return
    }
    if (!isRouteArray(route)) {
      res.status(400).json({ error: 'Invalid route' })
      return
    }
    if (!isFiniteNumber(distance) || distance < 0) {
      res.status(400).json({ error: 'Invalid distance' })
      return
    }
    if (timeToComplete != null && (!isFiniteNumber(timeToComplete) || timeToComplete < 0)) {
      res.status(400).json({ error: 'Invalid timeToComplete' })
      return
    }

    const student = session.data.students.find((entry) => entry.id === studentId)

    if (!student) {
      res.status(404).json({ error: 'Student not found' })
      return
    }

    student.currentRoute = route
    student.routeDistance = distance
    student.complete = route.length === session.data.problem.numCities
    if (student.complete) {
      student.routeCompleteTime = Date.now()
      student.timeToComplete = timeToComplete
      student.attempts = (student.attempts ?? 0) + 1
    } else {
      student.routeCompleteTime = null
      student.timeToComplete = null
    }

    await updateStudentStatus(session, () => true)

    res.json({ success: true })
  })
}
