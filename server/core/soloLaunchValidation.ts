/**
 * Activity-owned validation of the options a parent passes when it starts a
 * student-owned solo child (for example SyncDeck's `solo-activity/start`).
 * A student-owned child has no manager to configure it afterwards, so an
 * activity that cannot run without certain options rejects the launch here,
 * before the child session is created. Activities without a registered
 * validator accept any sanitized options.
 */
export type SoloLaunchOptionsValidation = { ok: true } | { ok: false; error: string }

export type SoloLaunchOptionsValidator = (selectedOptions: Record<string, unknown>) => SoloLaunchOptionsValidation

const soloLaunchValidators = new Map<string, SoloLaunchOptionsValidator>()

export function registerSoloLaunchOptionsValidator(activityType: string, validator: SoloLaunchOptionsValidator): void {
  if (typeof activityType !== 'string' || activityType.length === 0) {
    throw new Error('registerSoloLaunchOptionsValidator requires a non-empty activity type string')
  }
  if (typeof validator !== 'function') {
    throw new Error(`registerSoloLaunchOptionsValidator for "${activityType}" requires a function`)
  }
  soloLaunchValidators.set(activityType, validator)
}

export function validateSoloLaunchOptions(activityType: string, selectedOptions: Record<string, unknown>): SoloLaunchOptionsValidation {
  const validator = soloLaunchValidators.get(activityType)
  return validator ? validator(selectedOptions) : { ok: true }
}
