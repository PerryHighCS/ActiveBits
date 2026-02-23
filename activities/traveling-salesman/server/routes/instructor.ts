import type { WsRouter } from '../../../../types/websocket.js'
import type {
  TravelingSalesmanRouteApp,
  TravelingSalesmanSessionStore,
  TravelingSalesmanInstructorRoute,
} from '../../travelingSalesmanTypes.js'
import { asTravelingSalesmanSession } from '../../travelingSalesmanTypes.js'
import { isFiniteNumber, isRouteArray } from '../validation.js'
import { createBroadcastHelpers } from './shared.js'

export default function registerInstructorRoutes(
  app: TravelingSalesmanRouteApp,
  sessions: TravelingSalesmanSessionStore,
  ws: WsRouter,
): void {
  const { broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws)

  // Update instructor route (for persistence across reloads)
  app.post('/api/traveling-salesman/:sessionId/update-instructor-route', async (req, res) => {
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
    const route = body.route
    const distance = body.distance
    const complete = body.complete
    const timeToComplete = body.timeToComplete

    if (!isRouteArray(route)) {
      res.status(400).json({ error: 'Route required' })
      return
    }
    if (distance !== undefined && distance !== null && (!isFiniteNumber(distance) || distance < 0)) {
      res.status(400).json({ error: 'Invalid distance' })
      return
    }
    if (complete !== undefined && complete !== null && typeof complete !== 'boolean') {
      res.status(400).json({ error: 'Invalid complete flag' })
      return
    }
    if (timeToComplete != null && (!isFiniteNumber(timeToComplete) || timeToComplete < 0)) {
      res.status(400).json({ error: 'Invalid timeToComplete' })
      return
    }

    if (route.length === 0) {
      session.data.instructor = null
    } else {
      const progressTotal = session.data.problem?.numCities ?? route.length
      const progressCurrent = route.length
      const existingStartTime = session.data.instructor?.routeStartTime
      const routeStartTime = existingStartTime ?? Date.now()
      const computedTimeToComplete = complete && timeToComplete == null ? Math.floor((Date.now() - routeStartTime) / 1000) : timeToComplete

      const instructorRoute: TravelingSalesmanInstructorRoute = {
        id: 'instructor',
        name: 'Instructor',
        route,
        distance: distance ?? 0,
        type: 'instructor',
        timeToComplete: computedTimeToComplete ?? session.data.instructor?.timeToComplete ?? null,
        progressCurrent,
        progressTotal,
        complete: Boolean(complete),
        routeStartTime,
      }

      session.data.instructor = instructorRoute
    }

    await sessions.set(session.id, session)
    res.json({ success: true })
  })

  // Reset instructor route (and remove instructor broadcast)
  app.post('/api/traveling-salesman/:sessionId/reset-instructor-route', async (req, res) => {
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

    session.data.instructor = null
    session.data.broadcasts = session.data.broadcasts.filter((id) => id !== 'instructor')
    await sessions.set(session.id, session)

    await broadcastRoutesUpdate(session)
    res.json({ success: true })
  })

  // Broadcast custom route (e.g., instructor live build)
  app.post('/api/traveling-salesman/:sessionId/broadcast-route', async (req, res) => {
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
    const id = body.id
    const name = body.name
    const route = body.route
    const distance = body.distance
    const type = body.type
    const timeToComplete = body.timeToComplete

    if (!isRouteArray(route)) {
      res.status(400).json({ error: 'Route required' })
      return
    }
    if (distance !== undefined && distance !== null && (!isFiniteNumber(distance) || distance < 0)) {
      res.status(400).json({ error: 'Invalid distance' })
      return
    }
    if (timeToComplete != null && (!isFiniteNumber(timeToComplete) || timeToComplete < 0)) {
      res.status(400).json({ error: 'Invalid timeToComplete' })
      return
    }
    if (id !== undefined && id !== null && typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid id' })
      return
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      res.status(400).json({ error: 'Invalid name' })
      return
    }
    if (type !== undefined && type !== null && typeof type !== 'string') {
      res.status(400).json({ error: 'Invalid type' })
      return
    }

    if (route.length === 0) {
      res.status(400).json({ error: 'Route required' })
      return
    }

    const progressTotal = session.data.problem?.numCities ?? route.length
    const progressCurrent = route.length
    const complete = progressCurrent === progressTotal

    session.data.instructor = {
      id: id || 'instructor',
      name: name || 'Instructor',
      route,
      distance: distance ?? null,
      type: type || 'instructor',
      timeToComplete: timeToComplete ?? null,
      progressCurrent,
      progressTotal,
      complete,
    }

    await sessions.set(session.id, session)

    if (session.data.broadcasts.includes('instructor')) {
      await broadcastRoutesUpdate(session)
    }

    res.json({ success: true })
  })

  // Clear broadcasted solution
  app.post('/api/traveling-salesman/:sessionId/broadcast-clear', async (req, res) => {
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

    session.data.instructor = null
    session.data.broadcasts = []
    await sessions.set(session.id, session)

    await broadcastRoutesUpdate(session)
    res.json({ success: true })
  })
}
