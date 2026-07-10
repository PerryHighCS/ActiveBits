export interface ReactionOption {
  value: string
  label: string
  symbol: string
}

export const SHARED_REACTION_OPTIONS: readonly ReactionOption[] = [
  { value: '👍', label: 'Agree', symbol: '👍' },
  { value: '❤️', label: 'Love it', symbol: '❤️' },
  { value: '🔥', label: 'Fire', symbol: '🔥' },
  { value: '💡', label: 'Lightbulb', symbol: '💡' },
  { value: '😮', label: 'Surprised', symbol: '😮' },
  { value: '🤔', label: 'Hmm', symbol: '🤔' },
]

export const SHARED_REACTION_VALUES = SHARED_REACTION_OPTIONS.map((entry) => entry.value)

export function isSharedReactionValue(value: unknown): value is (typeof SHARED_REACTION_VALUES)[number] {
  return typeof value === 'string' && SHARED_REACTION_VALUES.includes(value)
}
