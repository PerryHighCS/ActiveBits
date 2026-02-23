import { useCallback, useState } from 'react'
import { getRouteDistance, isRouteComplete } from '../utils/distanceCalculator'
import type { DistanceMatrix } from '../utils/tspUtilsTypes'

interface RouteProgressPayload {
  route: string[]
  currentDistance: number
}

interface RouteCompletePayload {
  route: string[]
  distance: number
  timeToComplete: number
}

interface HydrateRouteInput {
  route?: string[]
  complete?: boolean
  distance?: number | null
  timeToComplete?: number | null
}

interface RouteBuilderResult {
  route: string[]
  isComplete: boolean
  currentDistance: number
  totalDistance: number
  timeToComplete: number | null
}

interface UseRouteBuilderOptions {
  cityCount?: number
  distanceMatrix?: DistanceMatrix | null
  onProgress?: (payload: RouteProgressPayload) => void
  onComplete?: (payload: RouteCompletePayload) => void
}

interface UseRouteBuilderReturn {
  route: string[]
  isComplete: boolean
  startTime: number | null
  currentDistance: number
  totalDistance: number
  timeToComplete: number | null
  setRoute: (route: string[]) => void
  setIsComplete: (isComplete: boolean) => void
  setStartTime: (startTime: number | null) => void
  setCurrentDistance: (distance: number) => void
  setTotalDistance: (distance: number) => void
  setTimeToComplete: (timeToComplete: number | null) => void
  resetRoute: () => void
  hydrateRoute: (input?: HydrateRouteInput) => void
  addCity: (cityId: string) => RouteBuilderResult | null
}

interface HydratedDistanceState {
  currentDistance: number
  totalDistance: number
}

export function resolveHydratedDistances(
  nextRoute: string[],
  complete: boolean,
  distance: number | null | undefined,
  distanceMatrix: DistanceMatrix | null,
): HydratedDistanceState {
  if (!nextRoute.length) {
    return { currentDistance: 0, totalDistance: 0 }
  }

  if (complete) {
    const total = Number.isFinite(distance) ? Number(distance) : getRouteDistance(nextRoute, distanceMatrix ?? [], true)
    return { currentDistance: total || 0, totalDistance: total || 0 }
  }

  const current = Number.isFinite(distance) ? Number(distance) : getRouteDistance(nextRoute, distanceMatrix ?? [], false)
  return { currentDistance: current || 0, totalDistance: 0 }
}

export function useRouteBuilder({
  cityCount = 0,
  distanceMatrix = null,
  onProgress,
  onComplete,
}: UseRouteBuilderOptions = {}): UseRouteBuilderReturn {
  const [route, setRoute] = useState<string[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [currentDistance, setCurrentDistance] = useState(0)
  const [totalDistance, setTotalDistance] = useState(0)
  const [timeToComplete, setTimeToComplete] = useState<number | null>(null)

  const resetRoute = useCallback(() => {
    setRoute([])
    setIsComplete(false)
    setStartTime(null)
    setCurrentDistance(0)
    setTotalDistance(0)
    setTimeToComplete(null)
  }, [])

  const hydrateRoute = useCallback(
    ({ route: nextRoute = [], complete = false, distance = null, timeToComplete: nextTimeToComplete = null }: HydrateRouteInput = {}) => {
      const normalizedRoute = Array.isArray(nextRoute) ? nextRoute : []
      const hydrated = resolveHydratedDistances(normalizedRoute, Boolean(complete), distance, distanceMatrix)

      setRoute(normalizedRoute)
      setIsComplete(Boolean(complete))
      setTimeToComplete(nextTimeToComplete ?? null)
      setCurrentDistance(hydrated.currentDistance)
      setTotalDistance(hydrated.totalDistance)
    },
    [distanceMatrix],
  )

  const addCity = useCallback(
    (cityId: string): RouteBuilderResult | null => {
      if (isComplete) return null
      if (!cityId) return null
      if (route.includes(cityId)) return null

      const now = Date.now()
      const nextStartTime = startTime ?? now
      if (startTime === null) {
        setStartTime(nextStartTime)
      }

      const nextRoute = [...route, cityId]
      const complete = isRouteComplete(nextRoute, cityCount)
      const current = getRouteDistance(nextRoute, distanceMatrix ?? [], false)
      setRoute(nextRoute)
      setCurrentDistance(current)

      if (complete) {
        const total = getRouteDistance(nextRoute, distanceMatrix ?? [], true)
        const completionTime = Math.floor((Date.now() - nextStartTime) / 1000)
        setIsComplete(true)
        setTotalDistance(total)
        setCurrentDistance(total)
        setTimeToComplete(completionTime)
        onComplete?.({
          route: nextRoute,
          distance: total,
          timeToComplete: completionTime,
        })
        return {
          route: nextRoute,
          isComplete: true,
          currentDistance: total,
          totalDistance: total,
          timeToComplete: completionTime,
        }
      }

      onProgress?.({
        route: nextRoute,
        currentDistance: current,
      })
      return {
        route: nextRoute,
        isComplete: false,
        currentDistance: current,
        totalDistance: 0,
        timeToComplete: null,
      }
    },
    [isComplete, route, startTime, cityCount, distanceMatrix, onComplete, onProgress],
  )

  return {
    route,
    isComplete,
    startTime,
    currentDistance,
    totalDistance,
    timeToComplete,
    setRoute,
    setIsComplete,
    setStartTime,
    setCurrentDistance,
    setTotalDistance,
    setTimeToComplete,
    resetRoute,
    hydrateRoute,
    addCity,
  }
}
