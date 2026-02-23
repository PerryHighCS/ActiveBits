export type JavaStringMethodId = 'all' | 'substring' | 'indexOf' | 'equals' | 'length' | 'compareTo'

export interface JavaStringStats {
  total: number
  correct: number
  streak: number
  longestStreak: number
}

export interface JavaStringStudentRecord {
  [key: string]: unknown
  id?: string
  name: string
  connected: boolean
  joined: number
  lastSeen: number
  stats: JavaStringStats
}

export interface JavaStringSessionData extends Record<string, unknown> {
  students: JavaStringStudentRecord[]
  selectedMethods: JavaStringMethodId[]
}

interface BaseChallenge {
  question: string
  hint: string
  type: Exclude<JavaStringMethodId, 'all'>
}

export interface SubstringChallenge extends BaseChallenge {
  type: 'substring'
  text: string
  varName: string
  start: number
  end?: number
  expectedAnswer: string
  methodType: '1-parameter' | '2-parameter'
}

export interface IndexOfChallenge extends BaseChallenge {
  type: 'indexOf'
  text: string
  varName: string
  searchTerm: string
  startIndex?: number
  expectedAnswer: number
  methodType: '1-parameter' | '2-parameter'
}

export interface EqualsChallenge extends BaseChallenge {
  type: 'equals'
  text1: string
  text2: string
  var1: string
  var2: string
  callingVar: string
  parameterVar: string
  expectedAnswer: boolean
}

export interface LengthChallenge extends BaseChallenge {
  type: 'length'
  text: string
  varName: string
  expectedAnswer: number
}

export type CompareToResult = 0 | 'negative' | 'positive'

export interface CompareToChallenge extends BaseChallenge {
  type: 'compareTo'
  text1: string
  text2: string
  var1: string
  var2: string
  callingVar: string
  parameterVar: string
  callingText: string
  parameterText: string
  expectedAnswer: CompareToResult
}

export type JavaStringChallenge =
  | SubstringChallenge
  | IndexOfChallenge
  | EqualsChallenge
  | LengthChallenge
  | CompareToChallenge

export type JavaStringAnswer = string | boolean | number

export interface FeedbackState {
  isCorrect: boolean
  message: string
}
