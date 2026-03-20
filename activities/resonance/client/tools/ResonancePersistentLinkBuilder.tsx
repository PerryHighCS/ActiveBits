import type { ActivityPersistentLinkBuilderProps } from '../../../../types/activity.js'

export default function ResonancePersistentLinkBuilder({ activityId }: ActivityPersistentLinkBuilderProps) {
  return (
    <div className="p-4">
      <p className="text-sm text-gray-500">
        [{activityId} — Resonance link builder coming soon]
      </p>
    </div>
  )
}
