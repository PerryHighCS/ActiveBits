export type QuestionType = 'free-response' | 'multiple-choice'
export type MCQSelectionMode = 'single' | 'multiple'
export const MAX_MCQ_OPTIONS = 10

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

export interface StudentMCQQuestion extends Omit<MCQQuestion, 'options'> {
  type: 'multiple-choice'
  options: StudentMCQOption[]
  selectionMode: MCQSelectionMode
}

/** Question shape sent to students — strips isCorrect from MCQ options */
export type StudentQuestion =
  | FreeResponseQuestion
  | StudentMCQQuestion

export type AnswerPayload =
  | { type: 'free-response'; text: string }
  | { type: 'multiple-choice'; selectedOptionIds: string[] }

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

export type ResponseProgressStatus = 'idle' | 'working' | 'submitted'

export interface ResponseProgress {
  questionId: string
  studentId: string
  studentName: string
  updatedAt: number
  status: ResponseProgressStatus
  answer: AnswerPayload | null
  responseId: string | null
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
  isOwnResponse?: boolean
  viewerReaction?: string | null
}

export interface ViewerRevealResponse {
  answer: AnswerPayload
  submittedAt: number
  instructorEmoji: string | null
  isShared: boolean
}

export interface ReviewedResponse {
  question: StudentQuestion
  answer: AnswerPayload
  submittedAt: number
  instructorEmoji: string
}

export interface QuestionReveal {
  questionId: string
  sharedAt: number
  correctOptionIds: string[] | null
  sharedResponses: SharedResponse[]
  viewerResponse?: ViewerRevealResponse | null
}

export interface Student {
  studentId: string
  name: string
  joinedAt: number
}

/** Session state snapshot safe to send to students */
export interface StudentSessionSnapshot {
  sessionId: string
  selfPacedMode: boolean
  activeQuestion: StudentQuestion | null
  activeQuestions: StudentQuestion[]
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionDeadlineAt: number | null
  reveals: QuestionReveal[]
  reviewedResponses: ReviewedResponse[]
  submittedAnswers: Record<string, AnswerPayload>
  /** Student-safe versions of revealed questions, so clients can show option text alongside reveal data. */
  revealedQuestions: StudentQuestion[]
}

/** Session state snapshot for instructor — includes all response data */
export interface InstructorSessionSnapshot {
  sessionId: string
  questions: Question[]
  activeQuestionId: string | null
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionDeadlineAt: number | null
  students: Student[]
  responses: ResponseWithName[]
  progress: ResponseProgress[]
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
