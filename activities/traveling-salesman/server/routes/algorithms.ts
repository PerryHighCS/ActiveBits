import type { WsRouter } from '../../../../types/websocket.js'
import type { TravelingSalesmanRouteApp, TravelingSalesmanSessionStore } from '../../travelingSalesmanTypes.js'
import { asTravelingSalesmanSession } from '../../travelingSalesmanTypes.js'
import { isFiniteNumber, isRouteArray } from '../validation.js'
import { createBroadcastHelpers } from './shared.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function registerAlgorithmRoutes(
  app: TravelingSalesmanRouteApp,
  sessions: TravelingSalesmanSessionStore,
  ws: WsRouter,
): void {
  const { broadcast, broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws)

  // Compute algorithms (receive results from client)
  app.post('/api/traveling-salesman/:sessionId/compute-algorithms', async (req, res) => {
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
    const bruteForce = isPlainObject(body.bruteForce) ? body.bruteForce : null
    const heuristic = isPlainObject(body.heuristic) ? body.heuristic : null

    if (bruteForce) {
      if (bruteForce.route != null && !isRouteArray(bruteForce.route)) {
        res.status(400).json({ error: 'Invalid bruteForce route' })
        return
      }
      if (bruteForce.distance !== undefined && bruteForce.distance !== null && (!isFiniteNumber(bruteForce.distance) || bruteForce.distance < 0)) {
        res.status(400).json({ error: 'Invalid bruteForce distance' })
        return
      }
      if (
        bruteForce.computeTime !== undefined &&
        bruteForce.computeTime !== null &&
        (!isFiniteNumber(bruteForce.computeTime) || bruteForce.computeTime < 0)
      ) {
        res.status(400).json({ error: 'Invalid bruteForce computeTime' })
        return
      }
      if (bruteForce.checked !== undefined && bruteForce.checked !== null && (!isFiniteNumber(bruteForce.checked) || bruteForce.checked < 0)) {
        res.status(400).json({ error: 'Invalid bruteForce checked' })
        return
      }
      if (
        bruteForce.totalChecks !== undefined &&
        bruteForce.totalChecks !== null &&
        (!isFiniteNumber(bruteForce.totalChecks) || bruteForce.totalChecks < 0)
      ) {
        res.status(400).json({ error: 'Invalid bruteForce totalChecks' })
        return
      }
      if (bruteForce.cancelled !== undefined && bruteForce.cancelled !== null && typeof bruteForce.cancelled !== 'boolean') {
        res.status(400).json({ error: 'Invalid bruteForce cancelled flag' })
        return
      }
    }

    if (heuristic) {
      if (heuristic.route != null && !isRouteArray(heuristic.route)) {
        res.status(400).json({ error: 'Invalid heuristic route' })
        return
      }
      if (heuristic.distance !== undefined && heuristic.distance !== null && (!isFiniteNumber(heuristic.distance) || heuristic.distance < 0)) {
        res.status(400).json({ error: 'Invalid heuristic distance' })
        return
      }
      if (
        heuristic.computeTime !== undefined &&
        heuristic.computeTime !== null &&
        (!isFiniteNumber(heuristic.computeTime) || heuristic.computeTime < 0)
      ) {
        res.status(400).json({ error: 'Invalid heuristic computeTime' })
        return
      }
    }

    if (bruteForce) {
      session.data.algorithms.bruteForce = {
        route: bruteForce.route as string[] | undefined,
        distance: (bruteForce.distance as number | undefined) ?? null,
        computeTime: (bruteForce.computeTime as number | undefined) ?? null,
        computed: bruteForce.cancelled !== true,
        cancelled: Boolean(bruteForce.cancelled),
        progressCurrent: (bruteForce.checked as number | undefined) ?? null,
        progressTotal: (bruteForce.totalChecks as number | undefined) ?? null,
        status: bruteForce.cancelled === true ? 'cancelled' : 'complete',
        computedAt: Date.now(),
      }
    }

    if (heuristic) {
      session.data.algorithms.heuristic = {
        route: heuristic.route as string[] | undefined,
        distance: (heuristic.distance as number | undefined) ?? null,
        computeTime: (heuristic.computeTime as number | undefined) ?? null,
        computed: true,
        status: 'complete',
        computedAt: Date.now(),
      }
    }

    await sessions.set(session.id, session)

    // Broadcast algorithm results
    await broadcast('algorithmsComputed', { bruteForce, heuristic }, session.id)

    if (session.data.broadcasts.length > 0) {
      await broadcastRoutesUpdate(session)
    }

    res.json({ success: true })
  })

  // Update algorithm progress (for long-running computations)
  app.post('/api/traveling-salesman/:sessionId/algorithm-progress', async (req, res) => {
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
    const bruteForce = isPlainObject(body.bruteForce) ? body.bruteForce : null
    const heuristic = isPlainObject(body.heuristic) ? body.heuristic : null

    if (bruteForce) {
      if (bruteForce.checked !== undefined && bruteForce.checked !== null && (!isFiniteNumber(bruteForce.checked) || bruteForce.checked < 0)) {
        res.status(400).json({ error: 'Invalid bruteForce checked' })
        return
      }
      if (
        bruteForce.totalChecks !== undefined &&
        bruteForce.totalChecks !== null &&
        (!isFiniteNumber(bruteForce.totalChecks) || bruteForce.totalChecks < 0)
      ) {
        res.status(400).json({ error: 'Invalid bruteForce totalChecks' })
        return
      }
      if (bruteForce.status !== undefined && bruteForce.status !== null && typeof bruteForce.status !== 'string') {
        res.status(400).json({ error: 'Invalid bruteForce status' })
        return
      }
    }

    if (heuristic) {
      if (heuristic.checked !== undefined && heuristic.checked !== null && (!isFiniteNumber(heuristic.checked) || heuristic.checked < 0)) {
        res.status(400).json({ error: 'Invalid heuristic checked' })
        return
      }
      if (
        heuristic.totalChecks !== undefined &&
        heuristic.totalChecks !== null &&
        (!isFiniteNumber(heuristic.totalChecks) || heuristic.totalChecks < 0)
      ) {
        res.status(400).json({ error: 'Invalid heuristic totalChecks' })
        return
      }
      if (heuristic.status !== undefined && heuristic.status !== null && typeof heuristic.status !== 'string') {
        res.status(400).json({ error: 'Invalid heuristic status' })
        return
      }
    }

    if (bruteForce) {
      session.data.algorithms.bruteForce = {
        ...session.data.algorithms.bruteForce,
        progressCurrent: (bruteForce.checked as number | undefined) ?? session.data.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: (bruteForce.totalChecks as number | undefined) ?? session.data.algorithms.bruteForce.progressTotal ?? null,
        status: (bruteForce.status as string | undefined) || session.data.algorithms.bruteForce.status || 'running',
      }
    }

    if (heuristic) {
      session.data.algorithms.heuristic = {
        ...session.data.algorithms.heuristic,
        progressCurrent: (heuristic.checked as number | undefined) ?? session.data.algorithms.heuristic.progressCurrent ?? null,
        progressTotal: (heuristic.totalChecks as number | undefined) ?? session.data.algorithms.heuristic.progressTotal ?? null,
        status: (heuristic.status as string | undefined) || session.data.algorithms.heuristic.status || 'running',
      }
    }

    await sessions.set(session.id, session)
    if (session.data.broadcasts.includes('bruteforce')) {
      await broadcastRoutesUpdate(session)
    }
    res.json({ success: true })
  })

  // Reset heuristic route
  app.post('/api/traveling-salesman/:sessionId/reset-heuristic', async (req, res) => {
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

    session.data.algorithms.heuristic = {}
    await sessions.set(session.id, session)

    await broadcastRoutesUpdate(session)
    res.json({ success: true })
  })

  // Broadcast solution (legacy single-route)
  app.post('/api/traveling-salesman/:sessionId/broadcast-solution', async (req, res) => {
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

    const solutionId = (req.body as { solutionId?: unknown } | undefined)?.solutionId
    if (typeof solutionId !== 'string' || !solutionId.trim()) {
      res.status(400).json({ error: 'Invalid solutionId' })
      return
    }

    let solution: {
      id: string
      name: string
      route: string[] | undefined
      distance: number | null | undefined
      type: string
      timeToComplete: number | null | undefined
    } | null = null

    // Find solution
    if (solutionId === 'bruteforce' && session.data.algorithms.bruteForce?.computed) {
      solution = {
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        route: session.data.algorithms.bruteForce.route,
        distance: session.data.algorithms.bruteForce.distance,
        type: 'bruteforce',
        timeToComplete: session.data.algorithms.bruteForce.computeTime,
      }
    } else if (solutionId === 'heuristic' && session.data.algorithms.heuristic?.computed) {
      solution = {
        id: 'heuristic',
        name: 'Nearest Neighbor',
        route: session.data.algorithms.heuristic.route,
        distance: session.data.algorithms.heuristic.distance,
        type: 'heuristic',
        timeToComplete: session.data.algorithms.heuristic.computeTime,
      }
    } else {
      const student = session.data.students.find((entry) => entry.id === solutionId)
      if (student) {
        solution = {
          id: student.id,
          name: student.name,
          route: student.currentRoute,
          distance: student.routeDistance,
          type: 'student',
          timeToComplete: student.timeToComplete,
        }
      }
    }

    if (solution) {
      await broadcast(
        'broadcastUpdate',
        {
          routes: [
            {
              id: solution.id,
              name: solution.name,
              path: solution.route,
              distance: solution.distance,
              type: solution.type,
              timeToComplete: solution.timeToComplete ?? null,
            },
          ],
        },
        session.id,
      )
    }

    res.json({ success: true })
  })
}
