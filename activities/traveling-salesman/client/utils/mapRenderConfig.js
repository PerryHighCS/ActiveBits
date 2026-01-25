export function buildMapRenderProps({
  activeRoute = [],
  hoverRoute = [],
  hoveredCityId = null,
  terrainSeed = null
} = {}) {
  return {
    activeRoute,
    hoverRoute,
    hoveredCityId,
    terrainSeed
  };
}

