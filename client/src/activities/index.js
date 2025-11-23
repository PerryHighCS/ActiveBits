/**
 * Activity Registry (auto-discovered)
 *
 * Activities declare metadata and entry points in `/activities/<id>/activity.config.js`.
 * We eagerly glob those configs and import the client entry for each, so adding
 * a new activity folder automatically registers it—no central list to update.
 */

const configModules = import.meta.glob('../../../activities/*/activity.config.js', { eager: true });
const clientModules = import.meta.glob('../../../activities/*/client/index.{js,jsx}', { eager: true });

const findClientModule = (activityId) => {
  const key = Object.keys(clientModules).find(k => k.includes(`/activities/${activityId}/client/index`));
  return key ? clientModules[key] : null;
};

export const activities = Object.entries(configModules).map(([path, mod]) => {
  const cfg = mod.default;
  const activityId = cfg?.id || path.split('/activities/')[1]?.split('/')[0];

  if (!cfg?.id) {
    console.warn(`Activity config at "${path}" is missing an id`);
    return null;
  }

  const clientModule = findClientModule(activityId);
  if (!clientModule) {
    console.warn(`No client entry found for activity "${activityId}"`);
    return null;
  }

  const components = clientModule.default ?? clientModule.activity ?? clientModule;
  return { ...cfg, ...components };
}).filter(Boolean);

export const activityMap = activities.reduce((map, activity) => {
  map[activity.id] = activity;
  return map;
}, {});

export const getActivity = (id) => activityMap[id];

export default activities;
