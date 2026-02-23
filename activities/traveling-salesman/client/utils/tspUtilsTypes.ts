export interface City {
  id: string
  name: string
  x: number
  y: number
}

export type DistanceMatrix = number[][]
export type RouteStep = string | number
export type MixedRoute = RouteStep[]

export interface BruteForceResult {
  route: string[] | null
  distance: number
  checked: number
  totalChecks: number
  cancelled: boolean
}

export interface BruteForceOptions {
  onProgress?: (checked: number, totalChecks: number) => void
  shouldCancel?: () => boolean
  progressEvery?: number
  yieldEvery?: number
  startIndex?: number
}

export interface HeuristicOptions {
  startIndex?: number
}

export interface HeuristicResult {
  route: string[]
  distance: number
}

export interface TimedBruteForceResult extends BruteForceResult {
  computeTime: number | null
}

export interface TimedHeuristicResult extends HeuristicResult {
  computeTime: number
}

export interface ManagerLeaderboardEntry {
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

export interface SoloAlgorithmResult {
  distance?: number | null
  computeTime?: number | null
}

export interface SoloAlgorithmProgress {
  running?: boolean
  current?: number | null
  total?: number | null
}

export interface SoloLeaderboardEntry {
  id: string
  name: string
  distance: number | null
  timeToComplete: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
  type: 'student' | 'bruteforce' | 'heuristic'
}

export interface LegendRouteLike {
  id: string
  type: string
  label?: string
  name?: string
  path?: string[]
  distance?: number | null
  timeToComplete?: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
}

export interface LegendItem {
  id: string
  type: string
  label?: string
  distance?: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
}

export interface RouteTypeStyle {
  label: string
  color: string
}

export type RouteTypeKey = 'student' | 'bruteforce' | 'heuristic' | 'instructor' | 'highlight'
export type RouteTypeMap = Record<RouteTypeKey, RouteTypeStyle>

export interface TerrainDust {
  type: 'dust'
  x: number
  y: number
  r: number
  opacity: number
}

export interface TerrainMesa {
  type: 'mesa'
  x: number
  y: number
  r: number
  opacity: number
}

export interface TerrainRidge {
  type: 'ridge'
  x1: number
  y1: number
  x2: number
  y2: number
  opacity: number
}

export interface TerrainCactus {
  type: 'cactus'
  x: number
  y: number
  size: number
  opacity: number
}

export interface TerrainTrail {
  type: 'trail'
  points: Array<[number, number]>
  opacity: number
}

export interface TerrainWash {
  type: 'wash'
  points: Array<[number, number]>
  opacity: number
}

export type TerrainElement = TerrainDust | TerrainMesa | TerrainRidge | TerrainCactus | TerrainTrail | TerrainWash

export interface TspProblemState {
  numCities?: number
  cities?: City[]
  distanceMatrix?: DistanceMatrix
  seed?: number
}

export interface TspStudentState {
  id: string
  name: string
  currentRoute?: string[]
  routeDistance?: number | null
  complete?: boolean
  timeToComplete?: number | null
  connected?: boolean
}

export interface TspAlgorithmState {
  route?: string[] | null
  distance?: number | null
  computeTime?: number | null
  computed?: boolean
  cancelled?: boolean
  progressCurrent?: number | null
  progressTotal?: number | null
  status?: string
  checked?: number
  totalChecks?: number
  name?: string
}

export interface TspAlgorithmsState {
  bruteForce?: TspAlgorithmState
  heuristic?: TspAlgorithmState
}

export interface TspInstructorRoute extends LegendRouteLike {
  route?: string[]
  complete?: boolean
}

export interface TspSessionData {
  broadcasts?: string[]
  problem?: TspProblemState
  students?: TspStudentState[]
  algorithms?: TspAlgorithmsState
  instructor?: TspInstructorRoute | null
}

export interface TspSessionMessage {
  type?: unknown
  payload?: unknown
}

export interface TspDisplayRoute extends LegendRouteLike {
  id: string
  type: string
}

export interface SoloAlgorithmsState {
  bruteForce: (TimedBruteForceResult & { name?: string }) | null
  heuristic: (TimedHeuristicResult & { name?: string }) | null
}

export interface SoloProgressState {
  bruteForce: {
    current: number
    total: number
    running: boolean
  }
  heuristic: {
    current: number
    total: number
    running: boolean
  }
}
