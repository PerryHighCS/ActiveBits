import * as React from 'react'
import { useRef, useState } from 'react'
import { isMcqAnswerCorrect } from '../../shared/mcq.js'
import type { ResonanceReport } from '../../shared/reportTypes.js'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function normalizeReportMcqAnswer(answer: Record<string, unknown>): { type: 'multiple-choice'; selectedOptionIds: string[] } | null {
  const selectedOptionIds = Array.isArray(answer.selectedOptionIds)
    ? answer.selectedOptionIds
    : typeof answer.selectedOptionId === 'string'
      ? [answer.selectedOptionId]
      : null

  if (
    !selectedOptionIds ||
    selectedOptionIds.length === 0 ||
    selectedOptionIds.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    return null
  }

  return {
    type: 'multiple-choice',
    selectedOptionIds,
  }
}

function isValidReportAnswer(answer: unknown): boolean {
  if (!isRecord(answer)) return false
  if (answer.type === 'free-response') {
    return typeof answer.text === 'string'
  }
  if (answer.type === 'multiple-choice') {
    return normalizeReportMcqAnswer(answer) !== null
  }
  return false
}

function isValidReportResponse(response: unknown): boolean {
  if (!isRecord(response)) return false
  if (typeof response.id !== 'string') return false
  return isValidReportAnswer(response.answer)
}

function isValidReportOption(option: unknown): boolean {
  if (!isRecord(option)) return false
  if (typeof option.id !== 'string' || option.id.trim().length === 0) return false
  if (typeof option.text !== 'string' || option.text.trim().length === 0) return false
  if (option.isCorrect !== undefined && typeof option.isCorrect !== 'boolean') return false
  return true
}

function isValidStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isValidReportReveal(reveal: unknown): boolean {
  if (!isRecord(reveal)) return false
  if (typeof reveal.questionId !== 'string' || reveal.questionId.trim().length === 0) return false
  if (typeof reveal.sharedAt !== 'number') return false
  if (reveal.correctOptionIds !== null && !isValidStringArray(reveal.correctOptionIds)) return false
  if (!Array.isArray(reveal.sharedResponses)) return false
  return true
}

function normalizeReportAnswer(answer: unknown): unknown {
  if (!isRecord(answer)) return answer
  if (answer.type === 'multiple-choice') {
    return normalizeReportMcqAnswer(answer)
  }
  return answer
}

/**
 * Performs a structural validation of a value parsed from an uploaded JSON
 * file and returns it typed as ResonanceReport, or null if it is malformed.
 * Only the shape needed to safely render the report is checked; extra fields
 * are tolerated so older/future versions remain loadable.
 */
export function parseResonanceReport(raw: unknown): ResonanceReport | null {
  if (!isRecord(raw)) return null
  if (raw.version !== 1) return null
  if (typeof raw.sessionId !== 'string' || raw.sessionId.trim().length === 0) return null
  if (typeof raw.exportedAt !== 'number') return null
  if (!Array.isArray(raw.students)) return null
  if (!Array.isArray(raw.questions)) return null

  const normalizedQuestions: ResonanceReport['questions'] = []

  for (const entry of raw.questions) {
    if (!isRecord(entry)) return null
    const q = entry.question
    if (!isRecord(q)) return null
    if (typeof q.id !== 'string' || q.id.trim().length === 0) return null
    if (q.type !== 'free-response' && q.type !== 'multiple-choice') return null
    if (typeof q.text !== 'string') return null
    if (q.type === 'multiple-choice') {
      if (!Array.isArray(q.options)) return null
      if (!q.options.every(isValidReportOption)) return null
    }
    if (!Array.isArray(entry.responses)) return null
    if (!entry.responses.every(isValidReportResponse)) return null
    const reveal = entry.reveal === undefined ? null : entry.reveal
    if (reveal !== null && !isValidReportReveal(reveal)) return null
    if (!isRecord(entry.annotations)) return null

    normalizedQuestions.push({
      ...entry,
      responses: entry.responses.map((response) =>
        isRecord(response)
          ? { ...response, answer: normalizeReportAnswer(response.answer) }
          : response,
      ),
      reveal,
    } as ResonanceReport['questions'][number])
  }

  return {
    ...raw,
    questions: normalizedQuestions,
  } as ResonanceReport
}

interface Props {
  report: ResonanceReport
}

function PercentBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${pct}%` }} role="presentation" />
      </div>
      <span className="w-8 text-right text-gray-500">{pct}%</span>
    </div>
  )
}

function QuestionSection({ q }: { q: ResonanceReport['questions'][number] }) {
  const { question, responses, reveal } = q
  const hasCorrectOption = question.type === 'multiple-choice' && question.options.some((option) => option.isCorrect === true)

  // MCQ poll summary: per-option counts
  const isPoll = question.type === 'multiple-choice' &&
    !hasCorrectOption

  const optionCounts: Map<string, number> = new Map()
  if (question.type === 'multiple-choice') {
    for (const r of responses) {
      if (r.answer.type === 'multiple-choice') {
        for (const optionId of r.answer.selectedOptionIds) {
          optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1)
        }
      }
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <header>
        <p className="text-xs text-gray-400 uppercase tracking-wide">
          {question.type === 'free-response' ? 'Free response' : isPoll ? 'Poll' : 'Multiple choice'}
        </p>
        <p className="text-base font-medium text-gray-900 mt-0.5">{question.text}</p>
        <p className="text-xs text-gray-500 mt-1">
          {responses.length} response{responses.length !== 1 ? 's' : ''}
          {reveal !== null && (
            <span className="ml-2 text-green-600">Results shared</span>
          )}
        </p>
      </header>

      {/* MCQ correct answer */}
      {question.type === 'multiple-choice' && !isPoll && reveal?.correctOptionIds && reveal.correctOptionIds.length > 0 && (
        <p className="text-sm text-green-700 font-medium">
          ✓ Correct:{' '}
          {reveal.correctOptionIds
            .map((id) => question.options.find((o) => o.id === id)?.text ?? id)
            .join(', ')}
        </p>
      )}

      {/* MCQ option breakdown */}
      {question.type === 'multiple-choice' && (
        <div className="space-y-1.5">
          {question.options.map((opt) => {
            const count = optionCounts.get(opt.id) ?? 0
            const pct = responses.length > 0 ? Math.round((count / responses.length) * 100) : 0
            const isCorrect = reveal?.correctOptionIds?.includes(opt.id) ?? false
            return (
              <div key={opt.id} className="space-y-0.5">
                <p className={`text-xs ${isCorrect ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                  {isCorrect && '✓ '}{opt.text}{' '}
                  <span className="text-gray-400">({count})</span>
                </p>
                <PercentBar pct={pct} />
              </div>
            )
          })}
        </div>
      )}

      {(() => {
        const revealedCorrectOptionIds = reveal?.correctOptionIds
        return question.type === 'multiple-choice' &&
          !isPoll &&
          responses.length > 0 &&
          revealedCorrectOptionIds &&
          revealedCorrectOptionIds.length > 0 ? (
        <p className="text-xs text-gray-500">
          {(() => {
            const correctResponseCount = responses.filter((response) =>
              response.answer.type === 'multiple-choice' &&
              isMcqAnswerCorrect(response.answer.selectedOptionIds, revealedCorrectOptionIds),
            ).length
            return `${correctResponseCount} correct response${correctResponseCount !== 1 ? 's' : ''}`
          })()}
        </p>
        ) : null
      })()}

      {/* Free-response answers */}
      {question.type === 'free-response' && (
        <ol className="space-y-1.5 list-decimal list-inside">
          {responses.map((r) => (
            <li key={r.id} className="text-sm text-gray-700">
              {r.answer.type === 'free-response' ? r.answer.text : '—'}
            </li>
          ))}
          {responses.length === 0 && (
            <li className="text-sm text-gray-400 italic list-none">No responses.</li>
          )}
        </ol>
      )}
    </section>
  )
}

/**
 * Renders a Resonance session report loaded from a JSON file.
 */
export function ResonanceReportView({ report }: Props) {
  return (
    <React.Fragment>
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Session {report.sessionId}</p>
            <p className="text-xs text-gray-400">
              Exported {new Date(report.exportedAt).toLocaleString()}
            </p>
          </div>
          <p className="text-sm text-gray-500">
            {report.students.length} student{report.students.length !== 1 ? 's' : ''} ·{' '}
            {report.questions.length} question{report.questions.length !== 1 ? 's' : ''}
          </p>
        </header>
        {report.questions.map((q) => (
          <QuestionSection key={q.question.id} q={q} />
        ))}
      </div>
    </React.Fragment>
  )
}

/**
 * Report loader — accepts a JSON file exported from a Resonance session.
 */
export default function ResonanceReport() {
  const [report, setReport] = useState<ResonanceReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function loadFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const report = parseResonanceReport(JSON.parse(String(e.target?.result)))
        if (report === null) {
          setError('Not a valid Resonance report file')
          return
        }
        setReport(report)
        setError(null)
      } catch {
        setError('Could not parse report file')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          htmlFor="resonance-report-file"
          className="cursor-pointer inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Load report JSON
        </label>
        <input
          ref={inputRef}
          id="resonance-report-file"
          type="file"
          accept=".json"
          className="sr-only"
          aria-label="Load Resonance report JSON file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file !== undefined) loadFile(file)
          }}
        />
        {report !== null && (
          <button
            type="button"
            onClick={() => {
              setReport(null)
              if (inputRef.current !== null) inputRef.current.value = ''
            }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      {error !== null && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      {report !== null && <ResonanceReportView report={report} />}

      {report === null && error === null && (
        <p className="text-sm text-gray-400 italic">
          Upload a JSON report exported from a Resonance session to view results here.
        </p>
      )}
    </div>
  )
}
