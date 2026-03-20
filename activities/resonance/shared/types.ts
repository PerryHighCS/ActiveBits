export type QuestionType = 'free-response' | 'multiple-choice'

export interface MCQOption {
  id: string
  text: string
  isCorrect?: boolean
}

export interface BaseQuestion {
  id: string
  type: QuestionType
  text: string
  order: number
  responseTimeLimitMs?: number | null
}

export interface FreeResponseQuestion extends BaseQuestion {
  type: 'free-response'
}

export interface MCQQuestion extends BaseQuestion {
  type: 'multiple-choice'
  options: MCQOption[]
}

export type Question = FreeResponseQuestion | MCQQuestion

/** MCQ option shape sent to students — no isCorrect field exposed before reveal */
export type StudentMCQOption = Omit<MCQOption, 'isCorrect'>

/** Question shape sent to students — strips isCorrect from MCQ options */
export type StudentQuestion =
  | FreeResponseQuestion
  | (Omit<MCQQuestion, 'options'> & { options: StudentMCQOption[] })

export type AnswerPayload =
  | { type: 'free-response'; text: string }
  | { type: 'multiple-choice'; selectedOptionId: string }

export interface Response {
  id: string
  questionId: string
  studentId: string
  submittedAt: number
  answer: AnswerPayload
}

export interface ResponseWithName extends Response {
  studentName: string
}

export interface InstructorAnnotation {
  starred: boolean
  flagged: boolean
  emoji: string | null
}

export interface SharedResponse {
  id: string
  questionId: string
  answer: AnswerPayload
  sharedAt: number
  instructorEmoji: string | null
  reactions: Record<string, number>
}

export interface QuestionReveal {
  questionId: string
  sharedAt: number
  correctOptionIds: string[] | null
  sharedResponses: SharedResponse[]
}

export interface Student {
  studentId: string
  name: string
  joinedAt: number
}

/** Session state snapshot safe to send to students */
export interface StudentSessionSnapshot {
  sessionId: string
  activeQuestion: StudentQuestion | null
  reveals: QuestionReveal[]
  /** Student-safe versions of revealed questions, so clients can show option text alongside reveal data. */
  revealedQuestions: StudentQuestion[]
}

/** Session state snapshot for instructor — includes all response data */
export interface InstructorSessionSnapshot {
  sessionId: string
  questions: Question[]
  activeQuestionId: string | null
  students: Student[]
  responses: ResponseWithName[]
  annotations: Record<string, InstructorAnnotation>
  reveals: QuestionReveal[]
}

/** WebSocket envelope for all Resonance messages */
export interface ResonanceWsEnvelope {
  version: '1'
  activity: 'resonance'
  sessionId: string
  type: string
  timestamp: number
  payload: unknown
}
