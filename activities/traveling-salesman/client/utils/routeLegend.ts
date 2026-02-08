import type { LegendItem, LegendRouteLike } from './tspUtilsTypes'

export const buildLegendItems = ({
  primary = null,
  routes = [],
}: {
  primary?: LegendItem | null
  routes?: LegendRouteLike[]
}): LegendItem[] => {
  const items: LegendItem[] = []
  if (primary) {
    items.push(primary)
  }

  routes.forEach((route) => {
    items.push({
      id: route.id,
      type: route.type,
      label: route.label ?? route.name,
      distance: route.distance ?? null,
      progressCurrent: route.progressCurrent ?? null,
      progressTotal: route.progressTotal ?? null,
    })
  })

  return items
}

export const dedupeLegendItems = (items: LegendItem[] = []): LegendItem[] => {
  const byId = new Map<string, LegendItem>()
  items.forEach((item) => {
    byId.set(item.id, item)
  })
  return Array.from(byId.values())
}
