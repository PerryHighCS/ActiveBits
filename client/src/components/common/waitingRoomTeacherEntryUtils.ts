import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'

export function shouldShowTeacherEntryToggle({
  allowTeacherSection,
  hasTeacherCookie,
  effectiveEntryOutcome,
  entryPolicy,
}: {
  allowTeacherSection: boolean
  hasTeacherCookie: boolean
  effectiveEntryOutcome: PersistentSessionEntryOutcome
  entryPolicy?: PersistentSessionEntryPolicy
}): boolean {
  return allowTeacherSection
    && !hasTeacherCookie
    && entryPolicy !== 'solo-only'
    && effectiveEntryOutcome === 'join-live'
}

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
