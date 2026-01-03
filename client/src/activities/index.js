import React from 'react';

/**
 * Activity Registry (auto-discovered)
 *
 * Activities declare metadata and entry points in `/activities/<id>/activity.config.js`.
 * We eagerly read configs (small) but lazy-load the client bundles so each activity
 * becomes its own chunk.
 */

const configModules = import.meta.glob('@activities/*/activity.config.js', { eager: true });
const clientModules = import.meta.glob('@activities/*/client/index.{js,jsx}');

const isDevelopment = import.meta.env.MODE === 'development';

const findClientLoader = (activityId) => {
  // Vite resolves @activities alias to relative path, so check both formats
  const key = Object.keys(clientModules).find((k) =>
    k.includes(`/${activityId}/client/index`) || k.includes(`@activities/${activityId}/client/index`)
  );
  return key ? clientModules[key] : null;
};

const resolveClientModule = async (loader) => {
  const mod = await loader();
  return mod.default ?? mod.activity ?? mod;
};

const createLazyComponent = (loader, selector, fallbackComponent = null) => {
  if (!loader) return null;

  return React.lazy(async () => {
    const resolved = await resolveClientModule(loader);
    const selected = selector(resolved);

    if (!selected && fallbackComponent) {
      return { default: fallbackComponent };
    }

    if (!selected) {
      throw new Error('Expected component not found in activity client module');
    }

    return { default: selected };
  });
};

export const activities = Object.entries(configModules)
  .map(([path, mod]) => {
    const cfg = mod.default;
    // Vite resolves @activities to relative path like ../activities/, so handle both
    const pathParts = path.split(/[@/]activities\//)[1]?.split('/');
    const activityId = cfg?.id || pathParts?.[0];

    if (!cfg?.id) {
      console.warn(`Activity config at "${path}" is missing an id`);
      return null;
    }

    // Skip dev-only activities in production builds
    if (cfg.isDev && !isDevelopment) {
      return null;
    }

    const clientLoader = findClientLoader(activityId);
    if (!clientLoader) {
      console.warn(`No client entry found for activity "${activityId}"`);
      return null;
    }

    const ManagerComponent = createLazyComponent(clientLoader, (resolved) => resolved.ManagerComponent);
    const StudentComponent = createLazyComponent(clientLoader, (resolved) => resolved.StudentComponent);
    const FooterComponent = createLazyComponent(
      clientLoader,
      (resolved) => {
        const content = resolved.footerContent;
        return content ? () => content : null;
      },
      () => null,
    );

    return {
      ...cfg,
      ManagerComponent,
      StudentComponent,
      FooterComponent,
      // Expose loader in case callers want to preload
      preload: () => resolveClientModule(clientLoader).then(() => {}),
    };
  })
  .filter(Boolean);

export const activityMap = activities.reduce((map, activity) => {
  map[activity.id] = activity;
  return map;
}, {});

export const getActivity = (id) => activityMap[id];

export default activities;
