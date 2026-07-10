export type PostboardPostStatus = 'pending' | 'approved' | 'rejected'
export type PostboardAuthorRole = 'student' | 'instructor'

export type PostboardReactionId = 'heart' | 'spark' | 'plus-one' | 'question'

export const POSTBOARD_REACTION_IDS: readonly PostboardReactionId[] = [
  'heart',
  'spark',
  'plus-one',
  'question',
]

export const POSTBOARD_REACTION_LABELS: Record<PostboardReactionId, string> = {
  heart: 'Heart',
  spark: 'Spark',
  'plus-one': 'Plus one',
  question: 'Question',
}

export const POSTBOARD_REACTION_SYMBOLS: Record<PostboardReactionId, string> = {
  heart: 'Heart',
  spark: 'Spark',
  'plus-one': '+1',
  question: '?',
}

export interface PostboardPrompt {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

export interface PostboardSettings {
  autoApprove: boolean
}

export interface PostboardPost {
  id: string
  promptId: string
  authorId: string
  authorName: string
  authorRole: PostboardAuthorRole
  text: string
  createdAt: number
  updatedAt: number
  status: PostboardPostStatus
  approvedAt: number | null
  rejectedAt: number | null
  hiddenAt: number | null
  order: number
}

export interface PostboardReactionStateEntry {
  byUser: Record<string, PostboardReactionId>
}

export type PostboardReactionState = Record<string, PostboardReactionStateEntry>

export type PostboardReactionCounts = Record<string, Partial<Record<PostboardReactionId, number>>>

export interface PostboardFlag {
  id: string
  postId: string
  flaggedBy: string
  reason?: string
  createdAt: number
}

export interface PostboardSessionData extends Record<string, unknown> {
  mode: 'postboard'
  instructorPasscode: string
  prompt: PostboardPrompt
  settings: PostboardSettings
  posts: PostboardPost[]
  reactions: PostboardReactionState
  flags: Record<string, PostboardFlag[]>
  embeddedLaunch?: Record<string, unknown>
}

export interface PostboardInstructorSnapshot {
  prompt: PostboardPrompt
  settings: PostboardSettings
  posts: PostboardPost[]
  reactionCounts: PostboardReactionCounts
  flags: Record<string, PostboardFlag[]>
}

export interface PostboardStudentPost {
  id: string
  promptId: string
  authorRole: PostboardAuthorRole
  authorLabel: 'Instructor' | 'Student'
  text: string
  createdAt: number
  updatedAt: number
  status: PostboardPostStatus
  approvedAt: number | null
  rejectedAt: number | null
  hiddenAt: number | null
  order: number
  isOwnPost: boolean
}

export interface PostboardStudentSnapshot {
  prompt: PostboardPrompt
  settings: Pick<PostboardSettings, 'autoApprove'>
  posts: PostboardStudentPost[]
  ownRejectedPosts: PostboardPost[]
  reactionCounts: PostboardReactionCounts
}

export function isPostboardReactionId(value: unknown): value is PostboardReactionId {
  return typeof value === 'string' && POSTBOARD_REACTION_IDS.includes(value as PostboardReactionId)
}
