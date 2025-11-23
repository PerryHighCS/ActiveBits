import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const activitiesRoot = path.resolve(__dirname, '..', '..', 'activities');

function discoverConfigPaths() {
  if (!fs.existsSync(activitiesRoot)) return [];
  const entries = fs.readdirSync(activitiesRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const configPath = path.join(activitiesRoot, entry.name, 'activity.config.js');
      return { id: entry.name, configPath };
    })
    .filter(entry => fs.existsSync(entry.configPath));
}

const discoveredConfigs = discoverConfigPaths();
export const ALLOWED_ACTIVITIES = discoveredConfigs.map(c => c.id);

export function isValidActivity(activityName) {
  return ALLOWED_ACTIVITIES.includes(activityName);
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
 */
export async function registerActivityRoutes(app, sessions, ws) {
  for (const { id, configPath } of discoveredConfigs) {
    try {
      const cfg = await loadConfig(configPath);
      const serverEntry = cfg.serverEntry;
      if (!serverEntry) {
        console.warn(`No serverEntry defined for activity "${id}"`);
        continue;
      }
      const mod = await import(serverEntry);
      const register = mod.default;
      if (typeof register === 'function') {
        register(app, sessions, ws);
      } else {
        console.warn(`serverEntry for activity "${id}" does not export a default function`);
      }
    } catch (err) {
      console.error(`Failed to load server routes for activity "${id}":`, err);
    }
  }
}
