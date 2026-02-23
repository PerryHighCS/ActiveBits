interface MapRenderConfig {
  activeRoute: string[]
  hoverRoute: string[]
  hoveredCityId: string | null
  terrainSeed?: number
}

interface BuildMapRenderPropsInput {
  activeRoute?: string[]
  hoverRoute?: string[]
  hoveredCityId?: string | null
  terrainSeed?: number
}

export function buildMapRenderProps({
  activeRoute = [],
  hoverRoute = [],
  hoveredCityId = null,
  terrainSeed,
}: BuildMapRenderPropsInput = {}): MapRenderConfig {
  return {
    activeRoute,
    hoverRoute,
    hoveredCityId,
    terrainSeed,
  }
}
