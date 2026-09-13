export type QuestionType = 'free-response' | 'multiple-choice'
export type MCQSelectionMode = 'single' | 'multiple'
export type ResonancePresentationMode = 'standard' | 'staged'
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
  choicesRevealed?: boolean
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
  activeQuestionRunRevision?: number | null
  /**
   * Client-assigned monotonic counter for this question/run's editing session,
   * bumped each time the student starts a fresh edit (initial answer, or
   * revisiting an already-submitted question in the same run). Lets the server
   * distinguish a draft queued before this submission (same or lower sequence,
   * stale) from a legitimate edit made after it (higher sequence) when both
   * carry the same activeQuestionRunRevision.
   */
  editSequence?: number
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

export interface StagedRunState {
  questionIds: string[]
  currentQuestionId: string | null
  currentIndex: number
  choicesRevealed: boolean
  completedQuestionIds: string[]
}

/** Session state snapshot safe to send to students */
export interface StudentSessionSnapshot {
  sessionId: string
  selfPacedMode: boolean
  presentationMode: ResonancePresentationMode
  stagedRun: StagedRunState | null
  activeQuestion: StudentQuestion | null
  activeQuestions: StudentQuestion[]
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionRunRevision: number | null
  activeQuestionDeadlineAt: number | null
  /**
   * Highest live-run revision this session has ever assigned, independent of
   * `activeQuestionRunRevision` resetting to null on self-paced fallback. Lets
   * clients order a self-paced snapshot against a previously observed live
   * run without mistaking it for a stale legacy snapshot.
   */
  lastActiveQuestionRunRevision: number | null
  reveals: QuestionReveal[]
  reviewedResponses: ReviewedResponse[]
  submittedAnswers: Record<string, AnswerPayload>
  /**
   * The `editSequence` recorded on each confirmed response in `submittedAnswers`.
   * A client that reloads mid-run has no local edit-sequence bookkeeping (that
   * counter lives only in memory), so without this it would default a
   * post-reload revision to sequence 1 — colliding with (or trailing) the
   * confirmed response already at sequence 1+ and having the revision silently
   * dropped as stale by the server's draft guard. Clients seed their local
   * counter from this value on reload instead of assuming 1.
   */
  submittedResponseEditSequences: Record<string, number>
  /** Student-safe versions of revealed questions, so clients can show option text alongside reveal data. */
  revealedQuestions: StudentQuestion[]
}

/** Session state snapshot for instructor — includes all response data */
export interface InstructorSessionSnapshot {
  sessionId: string
  presentationMode: ResonancePresentationMode
  stagedRun: StagedRunState | null
  questions: Question[]
  activeQuestionId: string | null
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionRunRevision: number | null
  activeQuestionDeadlineAt: number | null
  /**
   * Highest live-run revision this session has ever assigned, independent of
   * `activeQuestionRunRevision` resetting to null once a run ends. Lets an
   * instructor client order an ended-run snapshot against a delayed message
   * from the run that just ended, the same way `StudentSessionSnapshot` does.
   */
  lastActiveQuestionRunRevision: number | null
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
