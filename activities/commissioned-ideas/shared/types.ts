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
}

/** Student-visible participant shape — no moderation or connection metadata. */
export interface StudentSafeParticipant {
  id: string
  name: string
  teamId: string | null
}

/** A naming proposal as seen by a member of the proposing team. */
export interface StudentSafeProposal {
  id: string
  value: string
  voteCount: number
  proposedByMe: boolean
}

/** Naming details sent only to members of the team. Rejected proposals are omitted. */
export interface StudentTeamNaming {
  groupProposals: StudentSafeProposal[]
  projectProposals: StudentSafeProposal[]
  myGroupVote: string | null
  myProjectVote: string | null
}

/** Student-visible team shape — no raw votes, no other teams' proposals. */
export interface StudentSafeTeam {
  id: string
  groupName: string | null
  projectName: string | null
  registeredAt: number
  presenterOrder: number | null
  memberIds: string[]
  /** Present only on the viewer's own team. */
  naming?: StudentTeamNaming
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
  teams: Record<string, CommissionedIdeasTeam>
  participantRoster: Record<string, CommissionedIdeasParticipant>
  ballots: Record<string, CommissionedIdeasBallot>
  presentationHistory: PresentationHistoryEntry[]
  currentPresentationTeamId: string | null
  podiumRevealStep: PodiumRevealStep
  /** Podium the current reveal started from (see `reconcilePodiumReveal`); null while hidden. */
  podiumRevealKey: string | null
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
