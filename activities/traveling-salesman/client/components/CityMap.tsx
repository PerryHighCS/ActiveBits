import React, { useMemo, useState, useEffect } from 'react'
import { generateTerrainPattern } from '../utils/terrainGenerator'
import './CityMap.css'
import { ROUTE_TYPES } from '../utils/routeTypes'
import { formatDistance } from '../utils/formatters'
import type { DistanceMatrix, RouteTypeMap, TerrainElement } from '../utils/tspUtilsTypes'

interface CityMapCity {
  id: string
  x: number
  y: number
  name: string
}

interface CityMapRoute {
  id?: string
  path?: string[]
  type: string
  name?: string
  label?: string
  distance?: number | null
  timeToComplete?: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
}

interface CityMapProps {
  cities: CityMapCity[]
  routes?: CityMapRoute[]
  highlightedRoute?: CityMapRoute | null
  onCityClick?: (city: CityMapCity) => void
  onCityHover?: (city: CityMapCity) => void
  onCityLeave?: (city: CityMapCity) => void
  distanceMatrix?: DistanceMatrix | null
  activeRoute?: string[] | null
  hoverRoute?: string[] | null
  hoveredCityId?: string | null
  terrainSeed?: number
}

interface Marker {
  cityId: string
  color: string
}

interface Midpoint {
  x: number
  y: number
}

function getRoutePalette(type: string): { color: string } {
  return (ROUTE_TYPES as RouteTypeMap & Record<string, { color: string }>)[type] ?? ROUTE_TYPES.student
}

function getCityIndex(cityId: string): number | null {
  const raw = cityId.split('-')[1]
  if (!raw) return null
  const index = Number.parseInt(raw, 10)
  return Number.isFinite(index) ? index : null
}

export default function CityMap({
  cities,
  routes = [],
  highlightedRoute = null,
  onCityClick,
  onCityHover,
  onCityLeave,
  distanceMatrix = null,
  activeRoute = null,
  hoverRoute = null,
  hoveredCityId = null,
  terrainSeed = Date.now(),
}: CityMapProps): React.ReactElement {
  const width = 700
  const height = 500
  const [focusedCityId, setFocusedCityId] = useState<string | null>(null)
  const cityRefs = useMemo(() => new Map<string, SVGGElement>(), [])

  useEffect(() => {
    if (!focusedCityId && cities.length > 0) {
      setFocusedCityId(cities[0]?.id ?? null)
    }
  }, [cities, focusedCityId])

  const focusCityById = (cityId: string): void => {
    const node = cityRefs.get(cityId)
    const focusable = node as unknown as { focus?: () => void }
    if (focusable?.focus) {
      focusable.focus()
      setFocusedCityId(cityId)
    }
  }

  // Generate terrain elements using seeded random
  const terrainElements = useMemo<TerrainElement[]>(() => {
    if (!terrainSeed) return []
    return generateTerrainPattern(terrainSeed)
  }, [terrainSeed])

  // Helper to find city by ID
  const findCity = (cityId: string): CityMapCity | undefined => cities.find((city) => city.id === cityId)

  const getDistance = (fromId: string, toId: string): number | null => {
    if (!distanceMatrix || !fromId || !toId) return null
    const from = getCityIndex(fromId)
    const to = getCityIndex(toId)
    if (from == null || to == null) return null
    return distanceMatrix[from]?.[to] ?? null
  }

  const getMidpoint = (from: CityMapCity, to: CityMapCity): Midpoint => ({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  })

  const getStarPoints = (cx: number, cy: number, outerR = 10, innerR = 4, points = 5): string => {
    const coords: string[] = []
    const step = Math.PI / points
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerR : innerR
      const angle = i * step - Math.PI / 2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      coords.push(`${x},${y}`)
    }
    return coords.join(' ')
  }

  const getRouteColor = (route: CityMapRoute): string => {
    const baseColor = getRoutePalette(route.type).color
    if (highlightedRoute?.id === route.id) return ROUTE_TYPES.highlight.color
    return baseColor
  }

  const getStarStroke = (fill: string): string => {
    if (!fill || !fill.startsWith('#')) return '#0D47A1'
    const hex = fill.replace('#', '')
    if (hex.length !== 6) return '#0D47A1'
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    if ([r, g, b].some(Number.isNaN)) return '#0D47A1'

    const darken = (value: number) => Math.max(0, Math.min(255, Math.round(value * 0.6)))
    const toHex = (value: number) => value.toString(16).padStart(2, '0')
    return `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`
  }

  const markerOffsets = [
    { x: 0, y: -10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
    { x: -10, y: 0 },
  ]

  const routeMarkers: Marker[] = []
  routes.forEach((route) => {
    const path = Array.isArray(route.path) ? route.path : []
    if (!path.length) return
    const color = getRouteColor(route)
    const startId = path[0]
    const endId = path[path.length - 1]
    if (!startId || !endId) return
    routeMarkers.push({ cityId: startId, color })
    if (endId !== startId) {
      routeMarkers.push({ cityId: endId, color })
    }
  })
  const markerCounts: Record<string, number> = {}

  const renderDistanceLabels = (path: string[], color: string, keyPrefix: string): React.ReactElement | null => {
    if (path.length <= 1 || !distanceMatrix) return null
    const isComplete = path.length === cities.length

    return (
      <g key={`labels-${keyPrefix}`} className="route-distance-labels">
        {path.map((cityId, i) => {
          if (i === path.length - 1) return null
          const nextId = path[i + 1]
          if (!nextId) return null
          const from = findCity(cityId)
          const to = findCity(nextId)
          if (!from || !to) return null
          const distance = getDistance(cityId, nextId)
          const mid = getMidpoint(from, to)
          return (
            <text
              key={`${keyPrefix}-${cityId}-${i}`}
              x={mid.x}
              y={mid.y - 6}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill={color}
              className="distance-label"
            >
              {distance !== null ? formatDistance(distance) : ''}
            </text>
          )
        })}
        {isComplete
          ? (() => {
              const lastId = path[path.length - 1]
              const firstId = path[0]
              if (!lastId || !firstId) return null
              const from = findCity(lastId)
              const to = findCity(firstId)
              if (!from || !to) return null
              const distance = getDistance(lastId, firstId)
              const mid = getMidpoint(from, to)
              return (
                <text
                  key={`${keyPrefix}-close`}
                  x={mid.x}
                  y={mid.y - 6}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={color}
                  className="distance-label"
                >
                  {distance !== null ? formatDistance(distance) : ''}
                </text>
              )
            })()
          : null}
      </g>
    )
  }

  return (
    <svg width={width} height={height} className="city-map" role="img" aria-label="Traveling Salesman map">
      <title>Traveling Salesman map</title>
      {/* Terrain background */}
      <defs />

      <rect x="0" y="0" width={width} height={height} fill="#f0ebe0" rx="8" />

      {/* Terrain elements spread across full map */}
      <g className="terrain-layer">
        {terrainElements.map((el, idx) => {
          const sx = (val: number): number => (val / 100) * width
          const sy = (val: number): number => (val / 100) * height

          if (el.type === 'dust') {
            return <circle key={`dust-${idx}`} cx={sx(el.x)} cy={sy(el.y)} r={el.r} fill="#d4c5a9" opacity={el.opacity} />
          }

          if (el.type === 'mesa') {
            return <circle key={`mesa-${idx}`} cx={sx(el.x)} cy={sy(el.y)} r={el.r} fill="#c9b08a" opacity={el.opacity} />
          }

          if (el.type === 'ridge') {
            return (
              <line
                key={`ridge-${idx}`}
                x1={sx(el.x1)}
                y1={sy(el.y1)}
                x2={sx(el.x2)}
                y2={sy(el.y2)}
                stroke="#b59e7c"
                strokeWidth="1"
                opacity={el.opacity}
              />
            )
          }

          if (el.type === 'cactus') {
            const size = el.size
            return (
              <path
                key={`cactus-${idx}`}
                d={`M ${sx(el.x)} ${sy(el.y) - size} L ${sx(el.x)} ${sy(el.y) + size}
                    M ${sx(el.x) - size} ${sy(el.y)} L ${sx(el.x) + size} ${sy(el.y)}`}
                stroke="#7a8b4a"
                strokeWidth="1"
                opacity={el.opacity}
                fill="none"
              />
            )
          }

          if (el.type === 'trail') {
            const d = el.points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${sx(point[0])} ${sy(point[1])}`).join(' ')
            return (
              <path
                key={`trail-${idx}`}
                d={d}
                stroke="#c7b08f"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity={el.opacity}
                fill="none"
              />
            )
          }

          if (el.type === 'wash') {
            const points = el.points.map((point) => [sx(point[0]), sy(point[1])] as [number, number])
            const d = points.reduce((acc, point, i, all) => {
              if (i === 0) return `M ${point[0]} ${point[1]}`
              const prev = all[i - 1]
              if (!prev) return acc
              const midX = (prev[0] + point[0]) / 2
              const midY = (prev[1] + point[1]) / 2
              return `${acc} Q ${prev[0]} ${prev[1]} ${midX} ${midY}`
            }, '')

            return (
              <g key={`wash-${idx}`} opacity={el.opacity}>
                <path d={d} stroke="#cfc2ae" strokeWidth="3" fill="none" />
                <path d={d} stroke="#e2d8c8" strokeWidth="1.6" fill="none" />
              </g>
            )
          }

          return null
        })}
      </g>

      {/* Route lines - draw multiple routes with different colors */}
      {routes.map((route, idx) => {
        const path = Array.isArray(route.path) ? route.path : []
        if (!path.length) return null

        const color = getRouteColor(route)
        const totalRoutes = routes.length
        const layersAbove = totalRoutes - 1 - idx
        const strokeWidth = 2 + layersAbove * 2

        // Check if route is complete (visits all cities)
        const isComplete = path.length === cities.length

        return (
          <g key={`route-${route.id || idx}`} className="route-group">
            {path.map((cityId, i) => {
              const from = findCity(cityId)
              // Only close the loop if route is complete
              const isLastEdge = i === path.length - 1
              const nextId = path[(i + 1) % path.length]
              const to = isLastEdge && !isComplete ? null : nextId ? findCity(nextId) : null

              if (!from || !to) return null

              return (
                <line
                  key={`edge-${cityId}-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  className="route-edge"
                />
              )
            })}
          </g>
        )
      })}

      {/* Start/End markers for each route */}
      {routeMarkers.length > 0 ? (
        <g className="route-start-end-markers">
          {routeMarkers.map((marker, idx) => {
            const city = findCity(marker.cityId)
            if (!city) return null
            const count = markerCounts[marker.cityId] ?? 0
            markerCounts[marker.cityId] = count + 1
            const offset = markerOffsets[count % markerOffsets.length] ?? { x: 0, y: 0 }
            const fill = marker.color
            const stroke = getStarStroke(fill)
            return (
              <polygon
                key={`marker-${marker.cityId}-${idx}`}
                points={getStarPoints(city.x + offset.x, city.y + offset.y, 8, 3.5, 5)}
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
              />
            )
          })}
        </g>
      ) : null}

      {/* Distance labels for all displayed routes */}
      {routes.map((route, idx) => {
        const path = Array.isArray(route.path) ? route.path : []
        if (!path.length) return null
        return renderDistanceLabels(path, getRouteColor(route), `route-${route.id || idx}`)
      })}

      {/* Hover preview segment and distance */}
      {(hoverRoute || activeRoute) && hoveredCityId && distanceMatrix
        ? (() => {
            const routeForHover = hoverRoute || activeRoute
            if (!routeForHover || routeForHover.length === 0) return null
            if (routeForHover.includes(hoveredCityId)) return null

            const fromId = routeForHover[routeForHover.length - 1]
            if (!fromId) return null
            const from = findCity(fromId)
            const to = findCity(hoveredCityId)
            if (!from || !to) return null
            const distance = getDistance(fromId, hoveredCityId)
            const mid = getMidpoint(from, to)
            return (
              <g className="hover-preview">
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#FF5722"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  opacity="0.9"
                />
                <text
                  x={mid.x}
                  y={mid.y - 6}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="#FF5722"
                  className="distance-label"
                >
                  {distance !== null ? formatDistance(distance) : ''}
                </text>
              </g>
            )
          })()
        : null}

      {/* Cities as circles with labels */}
      {cities.map((city) => {
        const activeId = activeRoute?.[activeRoute.length - 1] || null
        const distanceToActive = activeId ? getDistance(activeId, city.id) : null
        const ariaLabel =
          distanceToActive !== null
            ? `City ${city.name}. Distance from current city: ${formatDistance(distanceToActive)}.`
            : `City ${city.name}.`

        return (
          <g
            key={city.id}
            onClick={() => onCityClick?.(city)}
            onMouseEnter={() => onCityHover?.(city)}
            onMouseLeave={() => onCityLeave?.(city)}
            onFocus={() => {
              onCityHover?.(city)
              setFocusedCityId(city.id)
            }}
            onBlur={() => onCityLeave?.(city)}
            onKeyDown={(event: React.KeyboardEvent<SVGGElement>) => {
              if (!onCityClick) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onCityClick(city)
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                const currentIndex = cities.findIndex((entry) => entry.id === city.id)
                if (currentIndex < 0) return
                const delta = event.shiftKey ? -1 : 1
                const nextIndex = (currentIndex + delta + cities.length) % cities.length
                const nextCity = cities[nextIndex]
                if (nextCity) focusCityById(nextCity.id)
              }
              const current = findCity(city.id)
              if (!current) return

              const findDirectional = (direction: string): CityMapCity | null => {
                const candidates = cities.filter((candidate) => candidate.id !== city.id)
                let best: CityMapCity | null = null
                let bestScore = Infinity
                for (const candidate of candidates) {
                  const dx = candidate.x - current.x
                  const dy = candidate.y - current.y
                  if (direction === 'ArrowLeft' && dx >= 0) continue
                  if (direction === 'ArrowRight' && dx <= 0) continue
                  if (direction === 'ArrowUp' && dy >= 0) continue
                  if (direction === 'ArrowDown' && dy <= 0) continue
                  const primary = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy)
                  const secondary = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx)
                  const score = primary * 3 + secondary
                  if (score < bestScore) {
                    bestScore = score
                    best = candidate
                  }
                }
                return best
              }

              if (event.key.startsWith('Arrow')) {
                event.preventDefault()
                const next = findDirectional(event.key)
                if (next) focusCityById(next.id)
              }
            }}
            tabIndex={focusedCityId === city.id ? 0 : -1}
            role="button"
            aria-label={ariaLabel}
            style={{ cursor: onCityClick ? 'pointer' : 'default' }}
            className="city-group"
            ref={(node) => {
              if (node) {
                cityRefs.set(city.id, node)
              } else {
                cityRefs.delete(city.id)
              }
            }}
          >
            {/* City marker (pin style) */}
            <circle
              cx={city.x}
              cy={city.y}
              r="24"
              fill="#fff"
              stroke="#333"
              strokeWidth="2"
              className="city-marker"
              role="img"
              aria-label={city.name}
            />
            {activeRoute && activeRoute[0] === city.id ? (
              <polygon
                points={getStarPoints(city.x, city.y, 10, 4, 5)}
                fill="#F4C542"
                stroke="#8A6D1A"
                strokeWidth="1.5"
              />
            ) : (
              <circle cx={city.x} cy={city.y} r="8" fill="#e74c3c" />
            )}

            {/* City name label */}
            <text
              x={city.x}
              y={city.y + 40}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="#333"
              className="city-label"
            >
              {city.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
