import type { WsRouter } from '../../../../types/websocket.js'
import type {
  TravelingSalesmanRouteApp,
  TravelingSalesmanSessionStore,
  TravelingSalesmanSocket,
} from '../../travelingSalesmanTypes.js'
import { asTravelingSalesmanSession } from '../../travelingSalesmanTypes.js'
import { connectAcceptedSessionParticipant } from 'activebits-server/core/acceptedSessionParticipants.js'
import { disconnectSessionParticipant, updateSessionParticipant } from 'activebits-server/core/sessionParticipants.js'
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

    if (client.sessionId) {
      ;(async () => {
        const session = asTravelingSalesmanSession(await sessions.get(client.sessionId || ''))
        if (session) {
          const result = connectAcceptedSessionParticipant({
            session,
            participants: session.data.students,
            participantId: studentId,
            participantName: studentName ?? null,
            createParticipant: (participantId, participantName, now) => ({
              id: participantId,
              name: participantName,
              connected: true,
              joined: now,
              lastSeen: now,
              currentRoute: [],
              routeDistance: 0,
              complete: false,
              attempts: 0,
              routeStartTime: null,
              routeCompleteTime: null,
              timeToComplete: null,
            }),
            generateParticipantId: () => generateStudentId(studentName ?? 'student'),
          })
          if (!result) {
            return
          }
          const { participantId } = result
          client.studentName = result.participantName
          client.studentId = participantId
          closeDuplicateStudentSockets(ws, client)

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
          const student = disconnectSessionParticipant({
            participants: session.data.students,
            participantId: client.studentId ?? null,
          })
          if (!student) return false
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

    const student = updateSessionParticipant({
      participants: session.data.students,
      participantId: studentId,
      update: (participant) => {
        participant.currentRoute = route
        participant.routeDistance = distance
        participant.complete = route.length === session.data.problem.numCities
        if (participant.complete) {
          participant.routeCompleteTime = Date.now()
          participant.timeToComplete = timeToComplete
          participant.attempts = (participant.attempts ?? 0) + 1
        } else {
          participant.routeCompleteTime = null
          participant.timeToComplete = null
        }
      },
    })

    if (!student) {
      res.status(404).json({ error: 'Student not found' })
      return
    }

    await updateStudentStatus(session, () => true)

    res.json({ success: true })
  })
}
