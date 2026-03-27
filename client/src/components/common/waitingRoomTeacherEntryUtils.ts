import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'

export function shouldResetTeacherEntryMode({
  hasTeacherCookie,
  effectiveEntryOutcome,
  shouldShowTeacherEntryToggle,
}: {
  hasTeacherCookie: boolean
  effectiveEntryOutcome: PersistentSessionEntryOutcome
  shouldShowTeacherEntryToggle: boolean
}): boolean {
  return hasTeacherCookie || effectiveEntryOutcome !== 'join-live' || !shouldShowTeacherEntryToggle
}
