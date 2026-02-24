import type { ActivityRegistryEntry } from '../../../../types/activity.js'

type PersistentLinkBuilderActivity = Pick<ActivityRegistryEntry, 'manageDashboard' | 'PersistentLinkBuilderComponent'>

export function resolveCustomPersistentLinkBuilder(activity: PersistentLinkBuilderActivity | null) {
  if (!activity?.manageDashboard?.customPersistentLinkBuilder) {
    return null
  }

  return activity.PersistentLinkBuilderComponent ?? null
}
