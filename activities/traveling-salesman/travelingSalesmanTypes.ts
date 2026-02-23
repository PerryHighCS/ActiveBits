import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket } from '../../types/websocket.js'

export interface TravelingSalesmanCity extends Record<string, unknown> {
  id: string
  name: string
  x: number
  y: number
}

export interface TravelingSalesmanProblem extends Record<string, unknown> {
  numCities?: number
  cities?: TravelingSalesmanCity[]
  distanceMatrix?: number[][]
  seed?: number
  generated?: number
}

export interface TravelingSalesmanStudent extends Record<string, unknown> {
  id: string
  name: string
  connected?: boolean
  joined?: number
  lastSeen?: number
  currentRoute: string[]
  routeDistance: number
  complete: boolean
  attempts?: number
  routeStartTime?: number | null
  routeCompleteTime?: number | null
  timeToComplete?: number | null
}

export interface TravelingSalesmanAlgorithmState extends Record<string, unknown> {
  route?: string[]
  distance?: number | null
  computeTime?: number | null
  computed?: boolean
  cancelled?: boolean
  progressCurrent?: number | null
  progressTotal?: number | null
  status?: string
  checked?: number
  totalChecks?: number
  computedAt?: number
}

export interface TravelingSalesmanInstructorRoute extends Record<string, unknown> {
  id: string
  name: string
  route: string[]
  distance: number | null
  type: string
  timeToComplete: number | null
  progressCurrent?: number
  progressTotal?: number
  complete?: boolean
  routeStartTime?: number
}

export interface TravelingSalesmanAlgorithms extends Record<string, unknown> {
  bruteForce: TravelingSalesmanAlgorithmState
  heuristic: TravelingSalesmanAlgorithmState
}

export interface TravelingSalesmanSessionData extends Record<string, unknown> {
  problem: TravelingSalesmanProblem
  students: TravelingSalesmanStudent[]
  algorithms: TravelingSalesmanAlgorithms
  sharedState: Record<string, unknown>
  instructor: TravelingSalesmanInstructorRoute | null
  broadcasts: string[]
}

export interface TravelingSalesmanSession extends SessionRecord {
  type?: string
  data: TravelingSalesmanSessionData
}

export interface TravelingSalesmanSocket extends ActiveBitsWebSocket {
  studentId?: string | null
  ignoreDisconnect?: boolean
}

export interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

export interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

export interface TravelingSalesmanRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

export interface TravelingSalesmanSessionStore extends Pick<SessionStore, 'get' | 'set'> {
  publishBroadcast?: (channel: string, message: Record<string, unknown>) => Promise<void>
  subscribeToBroadcast?: (channel: string, handler: (message: unknown) => void) => void
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeTravelingSalesmanSessionData(data: unknown): TravelingSalesmanSessionData {
  const source = isPlainObject(data) ? data : {}
  const algorithmsSource = isPlainObject(source.algorithms) ? source.algorithms : {}

  return {
    ...source,
    problem: isPlainObject(source.problem) ? (source.problem as TravelingSalesmanProblem) : {},
    students: Array.isArray(source.students) ? (source.students as TravelingSalesmanStudent[]) : [],
    algorithms: {
      bruteForce: isPlainObject(algorithmsSource.bruteForce)
        ? (algorithmsSource.bruteForce as TravelingSalesmanAlgorithmState)
        : {},
      heuristic: isPlainObject(algorithmsSource.heuristic)
        ? (algorithmsSource.heuristic as TravelingSalesmanAlgorithmState)
        : {},
    },
    sharedState: isPlainObject(source.sharedState) ? source.sharedState : { phase: 'setup' },
    instructor: isPlainObject(source.instructor) ? (source.instructor as TravelingSalesmanInstructorRoute) : null,
    broadcasts: Array.isArray(source.broadcasts) ? (source.broadcasts as string[]) : [],
  }
}

export function asTravelingSalesmanSession(session: SessionRecord | null): TravelingSalesmanSession | null {
  if (!session || session.type !== 'traveling-salesman') {
    return null
  }

  session.data = normalizeTravelingSalesmanSessionData(session.data)
  return session as TravelingSalesmanSession
}
