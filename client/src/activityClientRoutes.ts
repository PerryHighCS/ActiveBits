import type { ActivityRegistryEntry, ActivityRenderableComponent } from '../../types/activity.js'

export interface RegisteredActivityClientRoute {
  activityId: string
  id: string
  path: string
  Component: ActivityRenderableComponent
}

type ReportRouteRegistrationProblem = (message: string) => void

/** Resolves activity-owned routes once so the first valid activity owns each path. */
export function registerActivityClientRoutes(
  activities: readonly ActivityRegistryEntry[],
  reportProblem: ReportRouteRegistrationProblem = console.error,
): RegisteredActivityClientRoute[] {
  const claimedPaths = new Set<string>()
  const registeredRoutes: RegisteredActivityClientRoute[] = []

  for (const activity of activities) {
    for (const clientRoute of activity.clientRoutes ?? []) {
      const Component = activity.ClientRouteComponents?.[clientRoute.id]
      if (!Component) {
        reportProblem(`Skipping activity client route "${clientRoute.path}" because "${activity.id}" does not export "${clientRoute.id}".`)
        continue
      }
      if (claimedPaths.has(clientRoute.path)) {
        reportProblem(`Skipping duplicate activity client route "${clientRoute.path}" from "${activity.id}".`)
        continue
      }
      claimedPaths.add(clientRoute.path)
      registeredRoutes.push({ activityId: activity.id, ...clientRoute, Component })
    }
  }

  return registeredRoutes
}
