import type { CommissionedIdeasPhase } from '../../shared/types.js'

/**
 * Notice for a joined student who is not on a team after registration has closed,
 * or null when no notice applies. Registration stays open in every phase, but only
 * presentation and voting still lead to a ballot.
 */
export function lateArrivalNotice(phase: CommissionedIdeasPhase): string | null {
  switch (phase) {
    case 'registration':
      return null
    case 'presentation':
    case 'voting':
      return 'Teams are already formed. Your instructor will place you on a team — you can vote once you’re on one.'
    case 'results':
      return 'Teams are already formed and voting has closed. Your instructor can still place you on a team.'
  }
}
