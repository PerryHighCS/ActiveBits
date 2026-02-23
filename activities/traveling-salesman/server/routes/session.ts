import { createSession } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { WsRouter } from '../../../../types/websocket.js'
import type {
  TravelingSalesmanRouteApp,
  TravelingSalesmanSessionStore,
  TravelingSalesmanStudent,
} from '../../travelingSalesmanTypes.js'
import {
  asTravelingSalesmanSession,
  normalizeTravelingSalesmanSessionData,
} from '../../travelingSalesmanTypes.js'
import { isCitiesArray, isDistanceMatrix, isFiniteNumber } from '../validation.js'
import { createBroadcastHelpers } from './shared.js'

interface LeaderboardEntry {
  id: string
  name: string
  distance: number | null
  timeToComplete: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
  type: string
  connected?: boolean
  complete?: boolean
  status?: string
}

// Register session normalizer to ensure data integrity
registerSessionNormalizer('traveling-salesman', (session) => {
  session.data = normalizeTravelingSalesmanSessionData(session.data)
})

export default function registerSessionRoutes(
  app: TravelingSalesmanRouteApp,
  sessions: TravelingSalesmanSessionStore,
  ws: WsRouter,
): void {
  const { broadcast, broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws)

  // Create session
  app.post('/api/traveling-salesman/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'traveling-salesman'
    session.data = normalizeTravelingSalesmanSessionData(session.data)
    session.data.problem = {}
    session.data.students = []
    session.data.algorithms = { bruteForce: {}, heuristic: {} }
    session.data.instructor = null
    session.data.broadcasts = []
    session.data.sharedState = { phase: 'setup' }
    await sessions.set(session.id, session)
    res.json({ id: session.id })
  })

  // Get session state
  app.get('/api/traveling-salesman/:sessionId/session', async (req, res) => {
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
    res.json(session.data)
  })

  // Set problem (map generation)
  app.post('/api/traveling-salesman/:sessionId/set-problem', async (req, res) => {
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
    const cities = body.cities
    const distanceMatrix = body.distanceMatrix
    const seed = body.seed

    if (!isCitiesArray(cities)) {
      res.status(400).json({ error: 'Invalid cities payload' })
      return
    }
    if (!isDistanceMatrix(distanceMatrix, cities.length)) {
      res.status(400).json({ error: 'Invalid distance matrix' })
      return
    }
    if (!isFiniteNumber(seed)) {
      res.status(400).json({ error: 'Invalid seed' })
      return
    }

    session.data.problem = {
      numCities: cities.length,
      cities,
      distanceMatrix,
      seed,
      generated: Date.now(),
    }

    // Reset algorithms when new problem is generated
    session.data.algorithms = { bruteForce: {}, heuristic: {} }
    session.data.instructor = null
    session.data.broadcasts = []

    // Reset student routes
    session.data.students.forEach((student: TravelingSalesmanStudent) => {
      student.currentRoute = []
      student.routeDistance = 0
      student.complete = false
      student.routeStartTime = null
      student.routeCompleteTime = null
      student.timeToComplete = null
    })

    await sessions.set(session.id, session)

    // Broadcast to all students
    await broadcast('problemUpdate', { cities, distanceMatrix, seed }, session.id)
    await broadcastRoutesUpdate(session)

    res.json({ success: true })
  })

  // Reset all routes/broadcasts
  app.post('/api/traveling-salesman/:sessionId/reset-routes', async (req, res) => {
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

  // Get leaderboard
  app.get('/api/traveling-salesman/:sessionId/leaderboard', async (req, res) => {
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

    const leaderboard: LeaderboardEntry[] = []

    // Add student routes (including in-progress)
    session.data.students.forEach((student) => {
      if (student.currentRoute.length === 0) return
      leaderboard.push({
        id: student.id,
        name: student.name,
        distance: student.routeDistance,
        timeToComplete: student.timeToComplete ?? null,
        progressCurrent: student.currentRoute.length,
        progressTotal: session.data.problem.numCities,
        type: 'student',
        connected: student.connected,
        complete: student.complete,
      })
    })

    // Add instructor route (including in-progress)
    const instructor = session.data.instructor
    if (instructor != null && instructor.route.length > 0) {
      const instructorRouteLength = instructor.route.length
      leaderboard.push({
        id: 'instructor',
        name: instructor.name || 'Instructor',
        distance: instructor.distance ?? null,
        timeToComplete: instructor.timeToComplete ?? null,
        progressCurrent: instructor.progressCurrent ?? instructorRouteLength,
        progressTotal: instructor.progressTotal ?? session.data.problem.numCities,
        type: 'instructor',
        complete: instructor.complete,
      })
    }

    // Add brute force
    if (session.data.algorithms.bruteForce?.computed) {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: session.data.algorithms.bruteForce.distance ?? null,
        timeToComplete: session.data.algorithms.bruteForce.computeTime ?? null,
        type: 'bruteforce',
        complete: true,
      })
    } else if (
      (session.data.algorithms.bruteForce?.status != null && session.data.algorithms.bruteForce.status !== '') ||
      (session.data.algorithms.bruteForce?.progressTotal ?? 0) > 0
    ) {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: session.data.algorithms.bruteForce.distance ?? null,
        timeToComplete: null,
        progressCurrent: session.data.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: session.data.algorithms.bruteForce.progressTotal ?? null,
        type: 'bruteforce',
        status: session.data.algorithms.bruteForce.status,
      })
    } else {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'bruteforce',
      })
    }

    // Add heuristic
    if (session.data.algorithms.heuristic?.computed) {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: session.data.algorithms.heuristic.distance ?? null,
        timeToComplete: session.data.algorithms.heuristic.computeTime ?? null,
        type: 'heuristic',
        complete: true,
      })
    } else if (
      (session.data.algorithms.heuristic?.status != null && session.data.algorithms.heuristic.status !== '') ||
      (session.data.algorithms.heuristic?.progressTotal ?? 0) > 0
    ) {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: session.data.algorithms.heuristic.distance ?? null,
        timeToComplete: null,
        progressCurrent: session.data.algorithms.heuristic.progressCurrent ?? null,
        progressTotal: session.data.algorithms.heuristic.progressTotal ?? null,
        type: 'heuristic',
        status: session.data.algorithms.heuristic.status,
      })
    } else {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'heuristic',
      })
    }

    // Sort by completion first, then distance (ascending)
    leaderboard.sort((a, b) => {
      const aComplete = a.complete === true
      const bComplete = b.complete === true
      if (aComplete && !bComplete) return -1
      if (!aComplete && bComplete) return 1
      const aDistance = a.distance ?? Infinity
      const bDistance = b.distance ?? Infinity
      return aDistance - bDistance
    })

    res.json({ leaderboard })
  })

  // Set broadcast overlays
  app.post('/api/traveling-salesman/:sessionId/set-broadcasts', async (req, res) => {
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

    const broadcasts = (req.body as { broadcasts?: unknown } | undefined)?.broadcasts
    if (!Array.isArray(broadcasts) || !broadcasts.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'Invalid broadcasts payload' })
      return
    }

    session.data.broadcasts = broadcasts
    await sessions.set(session.id, session)

    await broadcastRoutesUpdate(session)
    res.json({ success: true })
  })
}
