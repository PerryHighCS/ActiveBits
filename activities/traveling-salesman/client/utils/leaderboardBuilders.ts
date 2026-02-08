import type {
  ManagerLeaderboardEntry,
  SoloAlgorithmProgress,
  SoloAlgorithmResult,
  SoloLeaderboardEntry,
} from './tspUtilsTypes'

interface ManagerLeaderboardInput {
  leaderboard?: ManagerLeaderboardEntry[]
  instructorRoute?: string[]
  instructorDistance?: number | null
  instructorComplete?: boolean
  instructorTimeToComplete?: number | null
  bruteForceStatus?: string
  bruteForceProgress?: {
    checked?: number | null
    total?: number | null
  } | null
  cityCount?: number | null
}

interface SoloLeaderboardInput {
  isSoloSession?: boolean
  currentRoute?: string[]
  isComplete?: boolean
  routeDistance?: number | null
  currentDistance?: number | null
  timeToComplete?: number | null
  soloAlgorithms?: {
    bruteForce?: SoloAlgorithmResult | null
    heuristic?: SoloAlgorithmResult | null
  }
  soloProgress?: {
    bruteForce?: SoloAlgorithmProgress
    heuristic?: SoloAlgorithmProgress
  }
  soloBruteForceStarted?: boolean
  soloComputing?: boolean
  citiesLength?: number
}

interface SoloLeaderboardResult {
  entries: SoloLeaderboardEntry[]
  sortedEntries: SoloLeaderboardEntry[]
  showSoloAlgorithms: boolean
}

export const sortByDistanceWithCompletion = (entries: ManagerLeaderboardEntry[] = []): ManagerLeaderboardEntry[] => {
  return [...entries].sort((a, b) => {
    const aComplete = a.complete === true
    const bComplete = b.complete === true
    if (aComplete && !bComplete) return -1
    if (!aComplete && bComplete) return 1
    const aDistance = a.distance ?? Infinity
    const bDistance = b.distance ?? Infinity
    return aDistance - bDistance
  })
}

export const buildManagerLeaderboardEntries = ({
  leaderboard = [],
  instructorRoute = [],
  instructorDistance = null,
  instructorComplete = false,
  instructorTimeToComplete = null,
  bruteForceStatus = 'idle',
  bruteForceProgress = null,
  cityCount = null,
}: ManagerLeaderboardInput): ManagerLeaderboardEntry[] => {
  const entries: ManagerLeaderboardEntry[] = [...leaderboard]

  if (instructorRoute.length > 0) {
    const existingIndex = entries.findIndex((entry) => entry.id === 'instructor')
    const entry: ManagerLeaderboardEntry = {
      id: 'instructor-local',
      name: 'Instructor',
      distance: instructorDistance ?? null,
      timeToComplete: instructorComplete ? instructorTimeToComplete : null,
      progressCurrent: instructorRoute.length,
      progressTotal: cityCount ?? null,
      type: 'instructor',
      complete: instructorComplete,
    }

    if (existingIndex >= 0) {
      entries[existingIndex] = { ...entries[existingIndex], ...entry }
    } else {
      entries.push(entry)
    }
  }

  if (!entries.find((entry) => entry.id === 'bruteforce')) {
    entries.push({
      id: 'bruteforce',
      name: 'Brute Force (Optimal)',
      distance: null,
      timeToComplete: null,
      progressCurrent: null,
      progressTotal: null,
      type: 'bruteforce',
      complete: false,
    })
  }

  if (!entries.find((entry) => entry.id === 'heuristic')) {
    entries.push({
      id: 'heuristic',
      name: 'Nearest Neighbor',
      distance: null,
      timeToComplete: null,
      progressCurrent: null,
      progressTotal: null,
      type: 'heuristic',
      complete: false,
    })
  }

  if (bruteForceStatus === 'running' || bruteForceStatus === 'cancelled') {
    const existingIndex = entries.findIndex((entry) => entry.id === 'bruteforce')
    const entry: ManagerLeaderboardEntry = {
      id: 'bruteforce',
      name: 'Brute Force (Optimal)',
      distance: null,
      timeToComplete: null,
      progressCurrent: bruteForceProgress?.checked ?? null,
      progressTotal: bruteForceProgress?.total ?? null,
      type: 'bruteforce',
      complete: false,
    }

    if (existingIndex >= 0) {
      entries[existingIndex] = { ...entries[existingIndex], ...entry }
    } else {
      entries.push(entry)
    }
  }

  return sortByDistanceWithCompletion(entries)
}

export const buildSoloLeaderboardEntries = ({
  isSoloSession = false,
  currentRoute = [],
  isComplete = false,
  routeDistance = null,
  currentDistance = null,
  timeToComplete = null,
  soloAlgorithms = {},
  soloProgress = { bruteForce: {}, heuristic: {} },
  soloBruteForceStarted = false,
  soloComputing = false,
  citiesLength = 0,
}: SoloLeaderboardInput): SoloLeaderboardResult => {
  if (!isSoloSession) {
    return { entries: [], sortedEntries: [], showSoloAlgorithms: false }
  }

  const showSoloAlgorithms =
    citiesLength > 0 &&
    (currentRoute.length > 0 ||
      soloBruteForceStarted ||
      soloComputing ||
      soloProgress.bruteForce?.running ||
      soloProgress.heuristic?.running ||
      soloAlgorithms.bruteForce ||
      soloAlgorithms.heuristic)

  const entries: SoloLeaderboardEntry[] = [
    ...(currentRoute.length > 0
      ? [
          {
            id: 'solo-student',
            name: 'My Route',
            distance: isComplete ? routeDistance : currentDistance,
            timeToComplete: isComplete ? timeToComplete : null,
            type: 'student' as const,
          } as SoloLeaderboardEntry,
        ]
      : []),
    ...(showSoloAlgorithms
      ? [
          {
            id: 'bruteforce',
            name: 'Brute Force (Optimal)',
            distance: soloAlgorithms.bruteForce?.distance ?? null,
            timeToComplete: soloAlgorithms.bruteForce?.computeTime ?? null,
            progressCurrent: soloProgress.bruteForce?.running ? soloProgress.bruteForce.current ?? null : null,
            progressTotal: soloProgress.bruteForce?.running ? soloProgress.bruteForce.total ?? null : null,
            type: 'bruteforce' as const,
          },
          {
            id: 'heuristic',
            name: 'Nearest Neighbor',
            distance: soloAlgorithms.heuristic?.distance ?? null,
            timeToComplete: soloAlgorithms.heuristic?.computeTime ?? null,
            progressCurrent: soloProgress.heuristic?.running ? soloProgress.heuristic.current ?? null : null,
            progressTotal: soloProgress.heuristic?.running ? soloProgress.heuristic.total ?? null : null,
            type: 'heuristic' as const,
          },
        ]
      : []),
  ]

  const sortedEntries = [...entries].sort((a, b) => {
    const isInProgress = (entry: SoloLeaderboardEntry): boolean => {
      if (entry.type === 'student') return !isComplete
      return entry.progressCurrent !== null && entry.progressCurrent !== undefined
    }

    const aInProgress = isInProgress(a)
    const bInProgress = isInProgress(b)
    if (aInProgress !== bInProgress) return aInProgress ? 1 : -1

    const aDistance = a.distance ?? Infinity
    const bDistance = b.distance ?? Infinity
    return aDistance - bDistance
  })

  return { entries, sortedEntries, showSoloAlgorithms: Boolean(showSoloAlgorithms) }
}
