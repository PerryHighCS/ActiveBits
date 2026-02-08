export type QuestionType = 'all' | 'index-get' | 'index-set' | 'len' | 'append' | 'remove' | 'insert' | 'pop' | 'for-range' | 'range-len' | 'for-each'

export interface PythonListPracticeStats {
  total: number
  correct: number
  streak: number
  longestStreak: number
}

export interface PythonListPracticeStudent extends Record<string, unknown> {
  id: string
  name: string
  stats: PythonListPracticeStats
  connected: boolean
  lastSeen?: number
}

export interface PythonListPracticeSessionData extends Record<string, unknown> {
  students: PythonListPracticeStudent[]
  selectedQuestionTypes: QuestionType[]
}
