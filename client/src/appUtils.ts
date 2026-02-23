import type { ActivityRegistryEntry } from '../../types/activity.js'

export function findFooterActivity(
  pathname: string,
  activityList: readonly ActivityRegistryEntry[],
): ActivityRegistryEntry | null {
  return (
    activityList.find(
      (activity) => pathname.startsWith(`/manage/${activity.id}`) && Boolean(activity.FooterComponent),
    ) ?? null
  )
}
