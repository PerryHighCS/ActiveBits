import type { InstructorAnnotation, Question, QuestionReveal, ResponseWithName, Student } from './types.js'

/**
 * Per-question summary used in report views and exports.
 * Annotations are instructor-private and included in full exports only.
 */
export interface ResonanceReportQuestion {
  question: Question
  responses: ResponseWithName[]
  reveal: QuestionReveal | null
  /** Keyed by responseId. Included in instructor-facing exports; omitted from student-safe views. */
  annotations: Record<string, InstructorAnnotation>
}

/**
 * Full session report. Generated server-side and returned by
 * GET /api/resonance/:sessionId/report, or assembled client-side from
 * an uploaded JSON export.
 */
export interface ResonanceReport {
  version: 1
  sessionId: string
  exportedAt: number
  students: Student[]
  questions: ResonanceReportQuestion[]
}
