export interface ReactionOption {
  value: string
  label: string
  symbol: string
}

export const SHARED_REACTION_OPTIONS = [
  { value: '👍', label: 'Agree', symbol: '👍' },
  { value: '❤️', label: 'Love it', symbol: '❤️' },
  { value: '🔥', label: 'Fire', symbol: '🔥' },
  { value: '💡', label: 'Lightbulb', symbol: '💡' },
  { value: '😮', label: 'Surprised', symbol: '😮' },
  { value: '🤔', label: 'Hmm', symbol: '🤔' },
] as const satisfies readonly ReactionOption[]

export type SharedReactionValue = (typeof SHARED_REACTION_OPTIONS)[number]['value']

export const SHARED_REACTION_VALUES = SHARED_REACTION_OPTIONS.map((entry) => entry.value) as readonly SharedReactionValue[]

export function isSharedReactionValue(value: unknown): value is SharedReactionValue {
  return typeof value === 'string' && (SHARED_REACTION_VALUES as readonly string[]).includes(value)
}
