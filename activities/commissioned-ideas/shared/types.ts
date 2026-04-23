export type CommissionedIdeasPhase = 'registration' | 'presentation' | 'voting' | 'results'

export type PodiumRevealStep = 'hidden' | 'third' | 'second' | 'winner' | 'complete'

export type GroupingMode = 'manual' | 'random'

export interface NameProposal {
  id: string
  value: string
  proposedByParticipantId: string
  createdAt: number
  rejectedByInstructor: boolean
}

export interface CommissionedIdeasTeam {
  id: string
  groupName: string | null
  projectName: string | null
  registeredAt: number
  presenterOrder: number | null
  locked: boolean
  memberIds: string[]
  proposedGroupNames: NameProposal[]
  proposedProjectNames: NameProposal[]
  /** Maps participantId -> proposalId */
  groupNameVotes: Record<string, string>
  /** Maps participantId -> proposalId */
  projectNameVotes: Record<string, string>
}

export interface CommissionedIdeasParticipant {
  id: string
  name: string
  teamId: string | null
  connected: boolean
  lastSeen: number
  rejectedByInstructor: boolean
  /** Server-only secret issued at registration; never included in any client snapshot. */
  token: string
}

/** Student-visible participant shape — no moderation or connection metadata. */
export interface StudentSafeParticipant {
  id: string
  name: string
  teamId: string | null
}

export interface BallotAllocation {
  teamId: string
  amount: 100 | 300 | 500
}

export interface CommissionedIdeasBallot {
  voterId: string
  voterName: string
  voterTeamId: string | null
  allocations: BallotAllocation[]
  submittedAt: number
}

export interface PresentationHistoryEntry {
  round: number
  teamId: string
  presentedAt: number
}

export interface CommissionedIdeasSessionData extends Record<string, unknown> {
  instructorPasscode: string
  phase: CommissionedIdeasPhase
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: GroupingMode
  presentationRound: number
  allowLateRegistration: boolean
  teams: Record<string, CommissionedIdeasTeam>
  participantRoster: Record<string, CommissionedIdeasParticipant>
  ballots: Record<string, CommissionedIdeasBallot>
  presentationHistory: PresentationHistoryEntry[]
  currentPresentationTeamId: string | null
  podiumRevealStep: PodiumRevealStep
}

export interface TeamScore {
  teamId: string
  groupName: string | null
  projectName: string | null
  totalDollars: number
  fiveHundredCount: number
  threeHundredCount: number
  oneHundredCount: number
  registeredAt: number
}
