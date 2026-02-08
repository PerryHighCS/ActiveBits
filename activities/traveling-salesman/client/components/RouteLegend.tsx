import React from 'react'
import ProgressBar from './ProgressBar'
import './RouteLegend.css'
import { ROUTE_TYPES } from '../utils/routeTypes'
import { formatDistance } from '../utils/formatters'
import { getProgressLabel } from '../utils/progressHelpers'
import type { LegendItem, RouteTypeMap } from '../utils/tspUtilsTypes'

interface RouteLegendProps {
  title?: string
  items?: LegendItem[]
}

function getRouteColor(type: string): string | undefined {
  return (ROUTE_TYPES as RouteTypeMap & Record<string, { color: string }>)[type]?.color
}

export default function RouteLegend({ title = 'Viewing', items = [] }: RouteLegendProps): React.ReactElement | null {
  if (!items.length) return null

  const bruteForceItem = items.find((item) => item.type === 'bruteforce')
  const showBruteForceProgress =
    Boolean(bruteForceItem) &&
    bruteForceItem?.progressCurrent !== null &&
    bruteForceItem?.progressCurrent !== undefined &&
    bruteForceItem?.progressTotal !== null &&
    bruteForceItem?.progressTotal !== undefined &&
    bruteForceItem.progressTotal !== bruteForceItem.progressCurrent

  return (
    <div className="route-legend">
      <div className="route-legend-title">{title}</div>
      {items.map((item) => (
        <div key={item.id} className={`route-legend-item ${item.type}`}>
          <span className="route-legend-swatch" style={{ background: getRouteColor(item.type) }} />
          <span className="route-legend-label">
            {item.label}
            {item.distance !== null && item.distance !== undefined ? ` (${formatDistance(item.distance)})` : ''}
          </span>
        </div>
      ))}
      {showBruteForceProgress ? (
        <ProgressBar
          value={bruteForceItem?.progressCurrent || 0}
          max={bruteForceItem?.progressTotal || 0}
          label={`Brute force checks: ${getProgressLabel(
            bruteForceItem?.progressCurrent || 0,
            bruteForceItem?.progressTotal || 0,
          )}`}
        />
      ) : null}
    </div>
  )
}
