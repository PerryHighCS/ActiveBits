import React from 'react';

/**
 * Activity Registry (auto-discovered)
 *
 * Activities declare metadata and entry points in `/activities/<id>/activity.config.{js,ts}`.
 * We eagerly read configs (small) but lazy-load the client bundles so each activity
 * becomes its own chunk.
 */

const configModules = import.meta.glob('@activities/*/activity.config.{js,ts}', { eager: true });
const clientModules = import.meta.glob('@activities/*/client/index.{js,jsx,ts,tsx}');

const CONFIG_EXTENSION_PRIORITY = ['.ts', '.js'];
const CLIENT_EXTENSION_PRIORITY = ['.tsx', '.ts', '.jsx', '.js'];

const isDevelopment = import.meta.env.MODE === 'development';

const getExtensionPriority = (modulePath, priorityOrder) => {
  const index = priorityOrder.findIndex((ext) => modulePath.endsWith(ext));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const selectPreferredModule = (modules, priorityOrder) => [...modules]
  .sort(
    ([leftPath], [rightPath]) =>
      getExtensionPriority(leftPath, priorityOrder) - getExtensionPriority(rightPath, priorityOrder),
  )[0];

const getPathActivityId = (modulePath) => modulePath.split(/[@/]activities\//)[1]?.split('/')[0] ?? null;

const preferredConfigEntries = (() => {
  const byActivityId = new Map();

  for (const [modulePath, moduleExports] of Object.entries(configModules)) {
    const cfg = moduleExports.default;

    if (!cfg?.id) {
      console.warn(`Activity config at "${modulePath}" is missing an id`);
      continue;
    }

    const existing = byActivityId.get(cfg.id);
    if (!existing) {
      byActivityId.set(cfg.id, [modulePath, moduleExports]);
      continue;
    }

    const preferred = selectPreferredModule([existing, [modulePath, moduleExports]], CONFIG_EXTENSION_PRIORITY);
    if (preferred[0] !== existing[0]) {
      console.warn(`Multiple config modules found for activity "${cfg.id}". Preferring "${preferred[0]}" over "${existing[0]}".`);
      byActivityId.set(cfg.id, preferred);
    }
  }

  return [...byActivityId.values()];
})();

const findClientLoader = (activityId) => {
  const candidates = Object.entries(clientModules).filter(([modulePath]) => {
    const moduleActivityId = getPathActivityId(modulePath);
    return moduleActivityId === activityId;
  });

  if (candidates.length === 0) {
    return null;
  }

  const preferred = selectPreferredModule(candidates, CLIENT_EXTENSION_PRIORITY);
  if (candidates.length > 1) {
    const discarded = candidates
      .map(([modulePath]) => modulePath)
      .filter((modulePath) => modulePath !== preferred[0]);
    console.warn(`Multiple client entry modules found for activity "${activityId}". Preferring "${preferred[0]}". Ignoring: ${discarded.join(', ')}`);
  }

  return preferred[1];
};

const resolveClientModule = async (loader) => {
  const mod = await loader();
  return mod.default ?? mod.activity ?? mod;
};

const createLazyComponent = (loader, selector, fallbackComponent = undefined, activityId = 'unknown', componentType = 'component') => {
  if (!loader) return null;

  return React.lazy(async () => {
    const resolved = await resolveClientModule(loader);
    const selected = selector(resolved);

    if (!selected) {
      if (fallbackComponent !== undefined) {
        return { default: fallbackComponent };
      }
      throw new Error(`${componentType} not found in activity "${activityId}" client module. Expected on the client module's default export object: { ${componentType}: Component }`);
    }

    return { default: selected };
  });
};

export const activities = preferredConfigEntries
  .map(([, mod]) => {
    const cfg = mod.default;
    const activityId = cfg.id;

    // Skip dev-only activities in production builds
    if (cfg.isDev && !isDevelopment) {
      return null;
    }

    const clientLoader = findClientLoader(activityId);
    if (!clientLoader) {
      console.warn(`No client entry found for activity "${activityId}"`);
      return null;
    }

    const ManagerComponent = createLazyComponent(clientLoader, (resolved) => resolved.ManagerComponent, undefined, activityId, 'ManagerComponent');
    const StudentComponent = createLazyComponent(clientLoader, (resolved) => resolved.StudentComponent, undefined, activityId, 'StudentComponent');
    const FooterComponent = createLazyComponent(
      clientLoader,
      (resolved) => {
        const content = resolved.footerContent;
        if (!content) return null;
        // If content is already a function/component, use it directly; otherwise wrap JSX in a component
        return typeof content === 'function' ? content : () => content;
      },
      () => null,
      activityId,
      'footerContent',
    );

    return {
      ...cfg,
      ManagerComponent,
      StudentComponent,
      FooterComponent,
    };
  })
  .filter(Boolean);

export const activityMap = activities.reduce((map, activity) => {
  map[activity.id] = activity;
  return map;
}, {});

export const getActivity = (id) => activityMap[id];

export default activities;
