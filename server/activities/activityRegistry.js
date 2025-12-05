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
 * Filter discovered configs to exclude dev-only activities in production.
 * Requires loading the config to check the isDev flag.
 * Returns configs with cached loadedConfig to avoid redundant loading.
 */
async function filterConfigsByDevFlag(configs) {
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
  
  // Load all configs and cache them
  const configsWithLoaded = [];
  for (const config of configs) {
    try {
      const loadedConfig = await loadConfig(config.configPath);
      configsWithLoaded.push({ ...config, loadedConfig });
    } catch (err) {
      if (!isDevelopment) {
        console.error(`\n[ERROR] Failed to load config for activity "${config.id}" at "${config.configPath}":\n`, err);
        console.error(`[FATAL] Cannot load activity config for "${config.id}" in production. Exiting startup.`);
        process.exit(1);
      }
      // In development, skip configs that fail to load
      console.warn(`[WARN] Failed to load config for activity "${config.id}", skipping:`, err.message);
    }
  }
  
  if (isDevelopment) {
    // In development, keep all activities
    return configsWithLoaded;
  }
  
  // In production, filter out activities with isDev: true
  return configsWithLoaded.filter(config => !config.loadedConfig.isDev);
}

const discoveredConfigs = discoverConfigPaths();
// Populated by initializeActivityRegistry() - must be called before using isValidActivity() or getAllowedActivities()
let ALLOWED_ACTIVITIES = [];
// Cached filtered configs with loadedConfig to avoid redundant loading
let filteredConfigs = [];

/**
 * Get the current list of allowed activities.
 * This list is filtered during initializeActivityRegistry() to exclude dev-only activities in production.
 * @returns {string[]} Array of allowed activity IDs (empty until initializeActivityRegistry() is called)
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
  filteredConfigs = await filterConfigsByDevFlag(discoveredConfigs);
  ALLOWED_ACTIVITIES = filteredConfigs.map(c => c.id);
  const devCount = discoveredConfigs.length - filteredConfigs.length;
  if (devCount > 0) {
    console.info(`[activities] Excluded ${devCount} dev-only ${devCount === 1 ? 'activity' : 'activities'}`);
  }
}

/**
 * Register activity-specific routes for all activities with a config.
 * A valid activity config provides a serverEntry that exports a default function (app, sessions, ws).
 * Only registers activities that are in ALLOWED_ACTIVITIES (filtered by initializeActivityRegistry).
 * Uses cached configs from initializeActivityRegistry to avoid redundant loading.
 */
export async function registerActivityRoutes(app, sessions, ws) {
  for (const { id, loadedConfig } of filteredConfigs) {
    try {
      const serverEntry = loadedConfig.serverEntry;
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
