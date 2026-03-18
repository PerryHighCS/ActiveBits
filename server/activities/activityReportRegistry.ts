import type { SessionRecord } from '../core/sessions.js'
import type { ActivityStructuredReportSection } from '../../types/activity.js'

export type ActivityReportBuilder = (
  session: SessionRecord,
  params: { instanceKey: string },
) => ActivityStructuredReportSection | null

const activityReportBuilders = new Map<string, ActivityReportBuilder>()

export function registerActivityReportBuilder(activityType: string, builder: ActivityReportBuilder): void {
  if (typeof activityType !== 'string' || activityType.length === 0) {
    throw new Error('registerActivityReportBuilder requires a non-empty activity type string')
  }
  if (typeof builder !== 'function') {
    throw new Error(`registerActivityReportBuilder for "${activityType}" requires a function`)
  }

  activityReportBuilders.set(activityType, builder)
}

export function getActivityReportBuilder(activityType: string): ActivityReportBuilder | null {
  return activityReportBuilders.get(activityType) ?? null
}

export function resetActivityReportBuildersForTests(): void {
  activityReportBuilders.clear()
}
