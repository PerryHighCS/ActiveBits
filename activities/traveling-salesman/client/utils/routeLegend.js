export const buildLegendItems = ({ primary = null, routes = [] }) => {
  const items = [];
  if (primary) {
    items.push(primary);
  }
  routes.forEach((route) => {
    items.push({
      id: route.id,
      type: route.type,
      label: route.label ?? route.name,
      distance: route.distance ?? null,
      progressCurrent: route.progressCurrent ?? null,
      progressTotal: route.progressTotal ?? null
    });
  });
  return items;
};

export const dedupeLegendItems = (items = []) => {
  const byId = new Map();
  items.forEach((item) => {
    byId.set(item.id, item);
  });
  return Array.from(byId.values());
};
