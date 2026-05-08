export type BinaryBreachChallengeType =
  | 'binary-to-decimal'
  | 'decimal-to-binary'
  | 'compare-binary'
  | 'order-binary'

export type BinaryBreachTimerMode = 'off' | 'generous' | 'standard'
export type BinaryBreachPlaceValueSupport = 'visible' | 'optional' | 'hidden'

export interface BinaryBreachSettings {
  maxBits: 4 | 5 | 6 | 7 | 8
  challengeTypes: BinaryBreachChallengeType[]
  missionLength: number
  timerMode: BinaryBreachTimerMode
  hintsEnabled: boolean
  placeValueSupport: BinaryBreachPlaceValueSupport
}

export interface BinaryBreachProgress {
  systemsRestored: number
  attempts: number
  correct: number
  incorrect: number
  streak: number
  bestStreak: number
  hintsUsed: number
  traceLevel: number
  score: number
  completed: boolean
}

export interface BinaryBreachStudentRecord {
  id: string
  name: string
  connected: boolean
  joined: number
  lastSeen: number
  progress: BinaryBreachProgress
  currentChallenge: BinaryBreachChallenge | null
  challengeIndex: number
}

export interface BinaryBreachSessionData extends Record<string, unknown> {
  settings: BinaryBreachSettings
  students: BinaryBreachStudentRecord[]
  missionSeed: string
  active: boolean
}

export interface BinaryBreachBaseChallenge {
  id: string
  type: BinaryBreachChallengeType
  systemName: string
  prompt: string
  promptEmphasis: string
  maxBits: number
  hintLevel: number
}

export interface BinaryToDecimalChallenge extends BinaryBreachBaseChallenge {
  type: 'binary-to-decimal'
  binary: string
  decimal: number
}

export interface DecimalToBinaryChallenge extends BinaryBreachBaseChallenge {
  type: 'decimal-to-binary'
  decimal: number
  binary: string
}

export interface CompareBinaryChallenge extends BinaryBreachBaseChallenge {
  type: 'compare-binary'
  left: string
  right: string
  target: 'larger' | 'smaller'
  answer: 'left' | 'right'
}

export interface OrderBinaryChallenge extends BinaryBreachBaseChallenge {
  type: 'order-binary'
  values: string[]
  direction: 'least-to-greatest' | 'greatest-to-least'
  answer: string[]
}

export type BinaryBreachChallenge =
  | BinaryToDecimalChallenge
  | DecimalToBinaryChallenge
  | CompareBinaryChallenge
  | OrderBinaryChallenge

export type BinaryBreachAnswer =
  | { type: 'binary-to-decimal'; decimal: string }
  | { type: 'decimal-to-binary'; binary: string }
  | { type: 'compare-binary'; choice: 'left' | 'right' }
  | { type: 'order-binary'; values: string[] }

export interface BinaryBreachFeedback {
  correct: boolean
  message: string
  expectedAnswer: string
  decimalValue?: number
}
