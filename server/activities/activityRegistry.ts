import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import activityConfigSchema from '../../types/activityConfigSchema.js'
import { isMissingDiscoveredConfigError } from './activityRegistryMissingConfigError.js'

interface ActivityConfigLike extends Record<string, unknown> {
  serverEntry?: string
  isDev?: boolean
}

interface DiscoveredConfig {
  id: string
  configPath: string
}

interface FilteredConfig extends DiscoveredConfig {
  loadedConfig: ActivityConfigLike
}

type ActivityRouteRegistrar = (app: unknown, sessions: unknown, ws: unknown) => void | Promise<void>

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const activitiesRoot = path.resolve(__dirname, '..', '..', 'activities')
const CONFIG_FILE_PRIORITY = ['activity.config.ts', 'activity.config.js']
const SERVER_ENTRY_EXTENSION_FALLBACKS = ['.ts', '.js']

function resolveConfigPath(activityDir: string): string | null {
  const configCandidates = CONFIG_FILE_PRIORITY
    .map((filename) => path.join(activityDir, filename))
    .filter((candidatePath) => fs.existsSync(candidatePath))

  if (configCandidates.length === 0) {
    return null
  }

  if (configCandidates.length > 1) {
    const preferredConfig = configCandidates[0]
    console.warn(
      `[activities] Multiple config files found for "${path.basename(activityDir)}". Preferring "${path.basename(preferredConfig || '')}".`,
    )
  }

  return configCandidates[0] || null
}

function resolveServerEntryUrl(serverEntry: unknown, baseUrl: URL): string | null {
  if (typeof serverEntry !== 'string' || !serverEntry) {
    return null
  }

  const requestedUrl = new URL(serverEntry, baseUrl)
  if (requestedUrl.protocol !== 'file:') {
    return requestedUrl.href
  }

  const requestedPath = fileURLToPath(requestedUrl)
  if (fs.existsSync(requestedPath)) {
    return requestedUrl.href
  }

  const requestedExt = path.extname(requestedPath)
  const baseEntryPath = requestedExt ? requestedPath.slice(0, -requestedExt.length) : requestedPath
  const candidateExtensions = requestedExt
    ? SERVER_ENTRY_EXTENSION_FALLBACKS.filter((extension) => extension !== requestedExt)
    : SERVER_ENTRY_EXTENSION_FALLBACKS

  for (const extension of candidateExtensions) {
    const candidatePath = `${baseEntryPath}${extension}`
    if (fs.existsSync(candidatePath)) {
      return pathToFileURL(candidatePath).href
    }
  }

  return requestedUrl.href
}

function discoverConfigPaths(): DiscoveredConfig[] {
  if (!fs.existsSync(activitiesRoot)) return []

  const entries = fs.readdirSync(activitiesRoot, { withFileTypes: true })
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev'
  const configs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const configPath = resolveConfigPath(path.join(activitiesRoot, entry.name))
      return { id: entry.name, configPath }
    })
    .filter((entry): entry is DiscoveredConfig => typeof entry.configPath === 'string' && fs.existsSync(entry.configPath))

  console.info(
    `[activities] Discovered ${configs.length} activity configs (${isDevelopment ? 'development' : 'production'} mode):`,
    configs.map((config) => config.id).join(', ') || '(none)',
  )
  return configs
}

async function loadConfig(configPath: string): Promise<ActivityConfigLike> {
  const moduleUrl = pathToFileURL(configPath)
  const mod = (await import(moduleUrl.href)) as { default?: unknown }
  const config = activityConfigSchema.parseActivityConfig(mod.default, configPath) as ActivityConfigLike
  const baseUrl = new URL('.', moduleUrl.href)
  return {
    ...config,
    baseUrl,
    serverEntry: resolveServerEntryUrl(config.serverEntry, baseUrl) ?? undefined,
  }
}

/**
 * Filter discovered configs to exclude dev-only activities in production.
 * Returns configs with cached loadedConfig to avoid redundant loading.
 */
async function filterConfigsByDevFlag(configs: DiscoveredConfig[]): Promise<FilteredConfig[]> {
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev'
  const configsWithLoaded: FilteredConfig[] = []

  for (const config of configs) {
    try {
      const loadedConfig = await loadConfig(config.configPath)
      configsWithLoaded.push({ ...config, loadedConfig })
    } catch (err) {
      if (isMissingDiscoveredConfigError(err, config.configPath)) {
        console.warn(`[activities] Config for "${config.id}" disappeared during registry initialization, skipping`)
        continue
      }

      if (!isDevelopment) {
        console.error(`\n[ERROR] Failed to load config for activity "${config.id}" at "${config.configPath}":\n`, err)
        console.error(`[FATAL] Cannot load activity config for "${config.id}" in production. Exiting startup.`)
        process.exit(1)
      }
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[WARN] Failed to load config for activity "${config.id}", skipping:`, message)
    }
  }

  if (isDevelopment) {
    return configsWithLoaded
  }

  return configsWithLoaded.filter((config) => !config.loadedConfig.isDev)
}

let discoveredConfigs: DiscoveredConfig[] = []
let ALLOWED_ACTIVITIES: string[] = []
let filteredConfigs: FilteredConfig[] = []

/**
 * Get the current list of allowed activities.
 */
export function getAllowedActivities(): string[] {
  return [...ALLOWED_ACTIVITIES]
}

export function isValidActivity(activityName: string): boolean {
  return ALLOWED_ACTIVITIES.includes(activityName)
}

/**
 * Initialize activity registry by filtering out dev-only activities in production.
 */
export async function initializeActivityRegistry(): Promise<void> {
  discoveredConfigs = discoverConfigPaths()
  filteredConfigs = await filterConfigsByDevFlag(discoveredConfigs)
  ALLOWED_ACTIVITIES = filteredConfigs.map((config) => config.id)
  const devCount = discoveredConfigs.length - filteredConfigs.length
  if (devCount > 0) {
    console.info(`[activities] Excluded ${devCount} dev-only ${devCount === 1 ? 'activity' : 'activities'}`)
  }
}

/**
 * Register activity-specific routes for all filtered activities.
 */
export async function registerActivityRoutes(app: unknown, sessions: unknown, ws: unknown): Promise<void> {
  for (const { id, loadedConfig } of filteredConfigs) {
    try {
      const serverEntry = loadedConfig.serverEntry
      if (!serverEntry) {
        console.warn(`No serverEntry defined for activity "${id}"`)
        continue
      }
      console.info(`[activities] Loading server entry for "${id}" from ${serverEntry}`)
      const mod = (await import(serverEntry)) as { default?: unknown }
      const register = mod.default
      if (typeof register === 'function') {
        await Promise.resolve((register as ActivityRouteRegistrar)(app, sessions, ws))
        console.info(`[activities] Registered routes for "${id}"`)
      } else {
        console.warn(`serverEntry for activity "${id}" does not export a default function`)
      }
    } catch (err) {
      console.error(`Failed to load server routes for activity "${id}":`, err)
    }
  }
}
