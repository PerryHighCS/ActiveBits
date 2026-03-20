/**
 * Curated emoji sets for Resonance instructor annotations and student reactions.
 *
 * Instructor annotation emojis can be intentionally shared with students as part
 * of the shared-response view. Star and flag annotations are separate private
 * fields and are never shared.
 *
 * Student reaction emojis are used to react to shared responses.
 */

export interface EmojiEntry {
  emoji: string
  label: string
}

/** Emojis available for instructor annotations on responses. */
export const INSTRUCTOR_ANNOTATION_EMOJIS: EmojiEntry[] = [
  { emoji: '🔥', label: 'On fire' },
  { emoji: '💡', label: 'Insightful' },
  { emoji: '⭐', label: 'Standout' },
  { emoji: '🎯', label: 'Spot on' },
  { emoji: '💯', label: 'Perfect' },
  { emoji: '🤔', label: 'Interesting' },
  { emoji: '❓', label: 'Needs clarification' },
  { emoji: '👀', label: 'Look at this' },
]

/** Emojis available for student reactions to shared responses. */
export const STUDENT_REACTION_EMOJIS: EmojiEntry[] = [
  { emoji: '👍', label: 'Agree' },
  { emoji: '❤️', label: 'Love it' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '💡', label: 'Lightbulb' },
  { emoji: '😮', label: 'Surprised' },
  { emoji: '🤔', label: 'Hmm' },
]

export const INSTRUCTOR_ANNOTATION_EMOJI_VALUES = INSTRUCTOR_ANNOTATION_EMOJIS.map((e) => e.emoji)
export const STUDENT_REACTION_EMOJI_VALUES = STUDENT_REACTION_EMOJIS.map((e) => e.emoji)

export function isValidInstructorAnnotationEmoji(emoji: string): boolean {
  return INSTRUCTOR_ANNOTATION_EMOJI_VALUES.includes(emoji)
}

export function isValidStudentReactionEmoji(emoji: string): boolean {
  return STUDENT_REACTION_EMOJI_VALUES.includes(emoji)
}
