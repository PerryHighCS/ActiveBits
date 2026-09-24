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
  activeQuestionRunRevision: number | null
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
   * Whether the server's own clock had reached `activeQuestionDeadlineAt` when
   * this snapshot was built (always false with no deadline or in self-paced
   * mode). Building a snapshot follows the server's expiry finalization, so
   * `true` means this student's drafts for the run are already finalized.
   * Clients must use this, not their own clock, to decide a deadline has
   * really passed.
   */
  activeQuestionDeadlineExpired: boolean
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
   * The viewer's own saved-but-not-yet-submitted answer for each active
   * question, as currently held by the server. Lets a remounted QuestionView
   * (or a freshly reloaded page) recover an in-progress edit from the server
   * instead of relying solely on locally-cached, possibly-lost state.
   */
  draftAnswers: Record<string, AnswerPayload>
  /**
   * The retained per-question `draftSendSequence` ordering floor for the
   * viewer's active questions. This may exist after a clear has removed the
   * corresponding `draftAnswers` entry. The server's update-draft guard
   * compares same-editSequence writes by this client-assigned counter.
   * A client that reloads mid-edit has no local
   * memory of how many times it already sent this question's draft (its own
   * counter restarts at 0), so without this it would stamp its first
   * post-reload send with a value lower than what's already stored, and the
   * server would reject that genuinely newer edit as stale. Clients ratchet
   * their local counter up to at least this value on load instead of
   * assuming 0.
   */
  draftSendSequences: Record<string, number>
  /**
   * The retained per-question `editSequence` ordering floor for the viewer's
   * active questions. This may exist after a clear has removed the matching
   * `draftAnswers` entry. A revisit
   * (`advanceEditSequenceForRevisit` in `ResonanceStudent.tsx`) can bump a
   * draft's `editSequence` above `confirmedEditSequence + 1` (e.g. a second
   * revisit, or a revisit whose local counter was already seeded past the
   * confirmed value by the time the student clicked it — see the
   * `seedEditSequenceFromConfirmedResponse` call site). A client that
   * reloads mid-edit has no local memory of that, so seeding only from
   * `submittedResponseEditSequences` can seed a *lower* value than what's
   * already stored, causing every post-reload edit to be rejected as stale
   * by the server's update-draft ordering guard. Clients seed the greater
   * of `confirmedEditSequence + 1` and this value instead of assuming the
   * former alone is always correct.
   */
  draftEditSequences: Record<string, number>
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
