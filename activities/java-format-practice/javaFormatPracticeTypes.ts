export type JavaFormatDifficulty = 'beginner' | 'intermediate' | 'advanced'

export type JavaFormatTheme = 'all' | 'wanted-poster' | 'fantasy-menu' | 'spy-badge'

export type JavaFormatVariableType = 'String' | 'int' | 'double'

export interface JavaFormatStats {
  total: number
  correct: number
  streak: number
  longestStreak: number
}

export interface JavaFormatStudentRecord {
  id?: string
  name: string
  connected: boolean
  joined: number
  lastSeen: number
  stats: JavaFormatStats
}

export interface JavaFormatSessionData extends Record<string, unknown> {
  students: JavaFormatStudentRecord[]
  selectedDifficulty: JavaFormatDifficulty
  selectedTheme: JavaFormatTheme
}

export type JavaFormatInputType = 'constant-string' | 'format-string' | 'string-literal' | 'variable'

export interface JavaFormatInput {
  type: JavaFormatInputType
  expected: string
}

export interface JavaFormatFormatCall {
  method: 'printf' | 'format'
  prompt: string
  skeleton: string
  answer: string
  inputs?: JavaFormatInput[]
  explanation?: string
  expectedOutput?: string
}

export interface JavaFormatVariableTemplate {
  key: string
  type: JavaFormatVariableType
  names: string[]
  values?: Array<string | number>
  range?: {
    min: number
    max: number
    step?: number
    precision?: number
  }
  defaultValue?: string | number
}

export interface JavaFormatVariable {
  name: string
  type: JavaFormatVariableType
  value: string
}

export interface JavaFormatChallengeDefinition {
  id: string
  title: string
  difficulty: JavaFormatDifficulty
  theme: JavaFormatTheme
  fileName: string
  startingLine: number
  scenario: string
  gridWidth: number
  gridHeight: number
  variableTemplates: JavaFormatVariableTemplate[]
  formatCalls: JavaFormatFormatCall[]
}

export interface JavaFormatChallenge extends JavaFormatChallengeDefinition {
  variables: JavaFormatVariable[]
  expectedOutput: string
  expectedOutputMask: string
}

export type JavaFormatFeedbackLine = {
  text?: string
  emphasis?: string
  textAfter?: string
}

export interface JavaFormatFeedback {
  isCorrect: boolean
  message: string | Array<string | JavaFormatFeedbackLine>
  explanation?: string
  wrongPartIdx?: number
  errorPartType?: JavaFormatInputType | string
  lineErrorsMeta?: Record<number, number>
  onDismiss?: () => void
}

export interface JavaFormatLineOutput {
  expectedOutput: string
  userOutput: string
  expectedMask: string
  userMask: string
  varName: string
  error?: string
}

export interface JavaFormatCycleMismatch {
  lineNumber: number
  expectedOutput?: string
  userOutput?: string
  error?: string
}

export interface ReferenceListItem {
  text: string
  bold?: string
  code?: string
}

export interface ReferenceTableSection {
  id: string
  type: 'table'
  title: string
  columns: string[]
  rows: Array<string[] | Record<string, string>>
}

export interface ReferenceListSection {
  id: string
  type: 'list'
  title: string
  items: ReferenceListItem[]
}

export type ReferenceSection = ReferenceTableSection | ReferenceListSection

export interface JavaFormatReferenceData {
  title?: string
  sections?: ReferenceSection[]
}
