import React, { type ComponentType } from 'react'
import type {
  ActivityClientModule,
  ActivityConfig,
  ActivityDeepLinkPreflightConfig,
  ActivityDeepLinkPreflightResult,
  ActivityRegistryEntry,
} from '../../../types/activity.js'
import activityConfigSchema from '../../../types/activityConfigSchema.js'

/**
 * Activity Registry (auto-discovered)
 *
 * Activities declare metadata and entry points in `/activities/<id>/activity.config.{js,ts}`.
 * We eagerly read configs (small) but lazy-load the client bundles so each activity
 * becomes its own chunk.
 */

interface ActivityConfigModule {
  default?: ActivityConfig
}

type ActivityClientResolved = ActivityClientModule & Record<string, unknown>

interface ActivityClientModuleExports extends Record<string, unknown> {
  default?: ActivityClientResolved
  activity?: ActivityClientResolved
}

type ActivityClientLoader = () => Promise<ActivityClientModuleExports>

const configModules = import.meta.glob<ActivityConfigModule>('@activities/*/activity.config.{js,ts}', { eager: true })
const clientModules = import.meta.glob<ActivityClientModuleExports>('@activities/*/client/index.{js,jsx,ts,tsx}')

const CONFIG_EXTENSION_PRIORITY = ['.ts', '.js'] as const
const CLIENT_EXTENSION_PRIORITY = ['.tsx', '.ts', '.jsx', '.js'] as const

const isDevelopment = import.meta.env.MODE === 'development'
const { parseActivityConfig } = activityConfigSchema

function getExtensionPriority(modulePath: string, priorityOrder: readonly string[]): number {
  const index = priorityOrder.findIndex((ext) => modulePath.endsWith(ext))
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function selectPreferredModule<T>(modules: Array<[string, T]>, priorityOrder: readonly string[]): [string, T] {
  return [...modules].sort(
    ([leftPath], [rightPath]) =>
      getExtensionPriority(leftPath, priorityOrder) - getExtensionPriority(rightPath, priorityOrder),
  )[0] as [string, T]
}

function getPathActivityId(modulePath: string): string | null {
  return modulePath.split(/[@/]activities\//)[1]?.split('/')[0] ?? null
}

const preferredConfigEntries = (() => {
  const byActivityId = new Map<string, [string, ActivityConfigModule]>()

  for (const [modulePath, moduleExports] of Object.entries(configModules)) {
    let cfg: ActivityConfig
    try {
      cfg = parseActivityConfig(moduleExports.default, modulePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Invalid activity config at "${modulePath}", skipping: ${message}`)
      continue
    }

    const existing = byActivityId.get(cfg.id)
    if (!existing) {
      byActivityId.set(cfg.id, [modulePath, moduleExports])
      continue
    }

    const preferred = selectPreferredModule([existing, [modulePath, moduleExports]], CONFIG_EXTENSION_PRIORITY)
    if (preferred[0] !== existing[0]) {
      console.warn(
        `Multiple config modules found for activity "${cfg.id}". Preferring "${preferred[0]}" over "${existing[0]}".`,
      )
      byActivityId.set(cfg.id, preferred)
    }
  }

  return [...byActivityId.values()]
})()

function findClientLoader(activityId: string): ActivityClientLoader | null {
  const candidates = Object.entries(clientModules).filter(([modulePath]) => {
    const moduleActivityId = getPathActivityId(modulePath)
    return moduleActivityId === activityId
  })

  if (candidates.length === 0) {
    return null
  }

  const preferred = selectPreferredModule(candidates, CLIENT_EXTENSION_PRIORITY)
  if (candidates.length > 1) {
    const discarded = candidates
      .map(([modulePath]) => modulePath)
      .filter((modulePath) => modulePath !== preferred[0])
    console.warn(
      `Multiple client entry modules found for activity "${activityId}". Preferring "${preferred[0]}". Ignoring: ${discarded.join(', ')}`,
    )
  }

  return preferred[1]
}

async function resolveClientModule(loader: ActivityClientLoader): Promise<ActivityClientResolved> {
  const mod = await loader()
  const resolved = mod.default ?? mod.activity ?? mod
  return (resolved != null && typeof resolved === 'object') ? (resolved as ActivityClientResolved) : {}
}

function createLazyComponent(
  loader: ActivityClientLoader | null,
  selector: (resolved: ActivityClientResolved) => ComponentType<unknown> | null | undefined,
  fallbackComponent: ComponentType<unknown> | undefined = undefined,
  activityId = 'unknown',
  componentType = 'component',
): React.LazyExoticComponent<ComponentType<unknown>> | null {
  if (!loader) return null

  return React.lazy(async () => {
    const resolved = await resolveClientModule(loader)
    const selected = selector(resolved)

    if (!selected) {
      if (fallbackComponent !== undefined) {
        return { default: fallbackComponent }
      }
      throw new Error(
        `${componentType} not found in activity "${activityId}" client module. Expected on the client module's default export object: { ${componentType}: Component }`,
      )
    }

    return { default: selected }
  })
}

export const activities: ActivityRegistryEntry[] = preferredConfigEntries
  .map<ActivityRegistryEntry | null>(([, mod]) => {
    const cfg = mod.default
    if (!cfg?.id) {
      return null
    }

    const activityId = cfg.id

    // Skip dev-only activities in production builds.
    if (cfg.isDev && !isDevelopment) {
      return null
    }

    const clientLoader = findClientLoader(activityId)
    if (!clientLoader) {
      console.warn(`No client entry found for activity "${activityId}"`)
      return null
    }

    const ManagerComponent = createLazyComponent(
      clientLoader,
      (resolved) => resolved.ManagerComponent,
      undefined,
      activityId,
      'ManagerComponent',
    )
    const StudentComponent = createLazyComponent(
      clientLoader,
      (resolved) => resolved.StudentComponent,
      undefined,
      activityId,
      'StudentComponent',
    )
    const FooterComponent = createLazyComponent(
      clientLoader,
      (resolved) => {
        const content = resolved.footerContent
        if (content === null || content === undefined) return null
        // If content is already a function/component, use it directly; otherwise wrap JSX in a component.
        return typeof content === 'function' ? content : (() => content)
      },
      () => null,
      activityId,
      'footerContent',
    )
    const PersistentLinkBuilderComponent = createLazyComponent(
      clientLoader,
      (resolved) => resolved.PersistentLinkBuilderComponent as ComponentType<unknown> | null | undefined,
      undefined,
      activityId,
      'PersistentLinkBuilderComponent',
    )

    return {
      ...cfg,
      ManagerComponent,
      StudentComponent,
      FooterComponent,
      PersistentLinkBuilderComponent,
    }
  })
  .filter((activity): activity is ActivityRegistryEntry => activity !== null)

export const activityMap: Record<string, ActivityRegistryEntry> = activities.reduce((map, activity) => {
  map[activity.id] = activity
  return map
}, {} as Record<string, ActivityRegistryEntry>)

export function getActivity(id: string): ActivityRegistryEntry | undefined {
  return activityMap[id]
}

export async function runActivityDeepLinkPreflight(
  activityId: string,
  preflight: ActivityDeepLinkPreflightConfig,
  rawValue: string,
): Promise<ActivityDeepLinkPreflightResult> {
  const clientLoader = findClientLoader(activityId)
  if (!clientLoader) {
    return { valid: false, warning: 'Validation is unavailable for this activity.' }
  }

  const resolved = await resolveClientModule(clientLoader)
  if (typeof resolved.runDeepLinkPreflight !== 'function') {
    return { valid: false, warning: 'Validation is unavailable for this activity.' }
  }

  return await resolved.runDeepLinkPreflight(preflight, rawValue)
}

export default activities
