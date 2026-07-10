import { SHARED_REACTION_OPTIONS, SHARED_REACTION_VALUES, isSharedReactionValue } from '../../shared/reactions.js'

export type PostboardPostStatus = 'pending' | 'approved' | 'rejected' | 'deleted'
export type PostboardAuthorRole = 'student' | 'instructor'

export type PostboardReactionId = (typeof SHARED_REACTION_VALUES)[number]

export const POSTBOARD_REACTION_IDS: readonly PostboardReactionId[] = SHARED_REACTION_VALUES

export const POSTBOARD_REACTION_LABELS = Object.fromEntries(
  SHARED_REACTION_OPTIONS.map((reaction) => [reaction.value, reaction.label]),
) as Record<PostboardReactionId, string>

export const POSTBOARD_REACTION_SYMBOLS = Object.fromEntries(
  SHARED_REACTION_OPTIONS.map((reaction) => [reaction.value, reaction.symbol]),
) as Record<PostboardReactionId, string>

export const POSTBOARD_REACTION_OPTIONS = SHARED_REACTION_OPTIONS.map((reaction) => ({
  ...reaction,
  value: reaction.value as PostboardReactionId,
}))

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
  styleId: string
  createdAt: number
  updatedAt: number
  status: PostboardPostStatus
  approvedAt: number | null
  rejectedAt: number | null
  deletedAt: number | null
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
  viewerReactions: Record<string, PostboardReactionId>
  flags: Record<string, PostboardFlag[]>
}

export interface PostboardStudentPost {
  id: string
  promptId: string
  authorRole: PostboardAuthorRole
  authorLabel: 'Instructor' | 'Student'
  text: string
  styleId: string
  createdAt: number
  updatedAt: number
  status: PostboardPostStatus
  approvedAt: number | null
  rejectedAt: number | null
  deletedAt: number | null
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
  viewerReactions: Record<string, PostboardReactionId>
}

export function isPostboardReactionId(value: unknown): value is PostboardReactionId {
  return isSharedReactionValue(value)
}
