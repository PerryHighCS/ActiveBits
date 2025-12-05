import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const activitiesRoot = path.resolve(__dirname, '..', '..', 'activities');

function discoverConfigPaths() {
  if (!fs.existsSync(activitiesRoot)) return [];
  const entries = fs.readdirSync(activitiesRoot, { withFileTypes: true });
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  const configs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const configPath = path.join(activitiesRoot, entry.name, 'activity.config.js');
      return { id: entry.name, configPath };
    })
    .filter(entry => fs.existsSync(entry.configPath));

  console.info(
    `[activities] Discovered ${configs.length} activity configs (${isDevelopment ? 'development' : 'production'} mode):`,
    configs.map(c => c.id).join(', ') || '(none)'
  );
  return configs;
}

/**
 * Filter discovered configs to exclude dev-only activities in production.
 * Requires loading the config to check the isDev flag.
 */
async function filterConfigsByDevFlag(configs) {
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  if (isDevelopment) {
    // In development, keep all activities
    return configs;
  }
  
  // In production, filter out activities with isDev: true
  const filtered = [];
  for (const config of configs) {
    try {
      const cfg = await loadConfig(config.configPath);
      if (!cfg.isDev) {
        filtered.push(config);
      }
    } catch (err) {
      console.error(`\n[ERROR] Failed to check isDev flag for activity "${config.id}" at "${config.configPath}":\n`, err);
      console.error(`[FATAL] Cannot load activity config for "${config.id}" in production. Exiting startup.`);
      process.exit(1);
    }
  }
  return filtered;
}

const discoveredConfigs = discoverConfigPaths();
let ALLOWED_ACTIVITIES = discoveredConfigs.map(c => c.id);

/**
 * Get the current list of allowed activities.
 * This list is filtered during initializeActivityRegistry() to exclude dev-only activities in production.
 */
export function getAllowedActivities() {
  return ALLOWED_ACTIVITIES;
}

export function isValidActivity(activityName) {
  return ALLOWED_ACTIVITIES.includes(activityName);
}

/**
 * Initialize activity registry by filtering out dev-only activities in production.
 * Must be called during server startup before handling requests.
 */
export async function initializeActivityRegistry() {
  const filtered = await filterConfigsByDevFlag(discoveredConfigs);
  ALLOWED_ACTIVITIES = filtered.map(c => c.id);
  const devCount = discoveredConfigs.length - filtered.length;
  if (devCount > 0) {
    console.info(`[activities] Excluded ${devCount} dev-only activity/activities`);
  }
}

async function loadConfig(configPath) {
  const moduleUrl = pathToFileURL(configPath);
  const mod = await import(moduleUrl.href);
  const cfg = mod.default || {};
  const baseUrl = new URL('.', moduleUrl.href);
  return {
    ...cfg,
    baseUrl,
    serverEntry: cfg.serverEntry ? new URL(cfg.serverEntry, baseUrl).href : null,
  };
}

/**
 * Register activity-specific routes for all activities with a config.
 * A valid activity config provides a serverEntry that exports a default function (app, sessions, ws).
 * Only registers activities that are in ALLOWED_ACTIVITIES (filtered by initializeActivityRegistry).
 */
export async function registerActivityRoutes(app, sessions, ws) {
  for (const { id, configPath } of discoveredConfigs) {
    if (!ALLOWED_ACTIVITIES.includes(id)) {
      continue;
    }
    try {
      const cfg = await loadConfig(configPath);
      const serverEntry = cfg.serverEntry;
      if (!serverEntry) {
        console.warn(`No serverEntry defined for activity "${id}"`);
        continue;
      }
      console.info(`[activities] Loading server entry for "${id}" from ${serverEntry}`);
      const mod = await import(serverEntry);
      const register = mod.default;
      if (typeof register === 'function') {
        register(app, sessions, ws);
        console.info(`[activities] Registered routes for "${id}"`);
      } else {
        console.warn(`serverEntry for activity "${id}" does not export a default function`);
      }
    } catch (err) {
      console.error(`Failed to load server routes for activity "${id}":`, err);
    }
  }
}
