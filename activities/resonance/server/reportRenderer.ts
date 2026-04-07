import { isMcqAnswerCorrect } from '../shared/mcq.js'
import type { InstructorAnnotation, Question, QuestionReveal, Response, Student } from '../shared/types.js'
import type { ResonanceReport, ResonanceReportQuestion } from '../shared/reportTypes.js'

/**
 * Minimal session data shape needed to build a report.
 * Passed directly from the route handler rather than importing the full session type.
 */
export interface ResonanceReportSessionData {
  id: string
  questions: Question[]
  students: Record<string, Student>
  responses: Response[]
  annotations: Record<string, InstructorAnnotation>
  reveals: QuestionReveal[]
}

// ---------------------------------------------------------------------------
// Report data assembly
// ---------------------------------------------------------------------------

/**
 * Assembles a ResonanceReport from live session data.
 */
export function buildResonanceReport(session: ResonanceReportSessionData): ResonanceReport {
  const { questions, students, responses, annotations, reveals } = session

  const responsesByQuestionId = new Map<string, Response[]>()
  for (const response of responses) {
    const existing = responsesByQuestionId.get(response.questionId)
    if (existing) {
      existing.push(response)
    } else {
      responsesByQuestionId.set(response.questionId, [response])
    }
  }

  const revealsByQuestionId = new Map<string, QuestionReveal>()
  for (const reveal of reveals) {
    revealsByQuestionId.set(reveal.questionId, reveal)
  }

  const questionSections: ResonanceReportQuestion[] = questions.map((q) => {
    const qResponses = responsesByQuestionId.get(q.id) ?? []
    const enriched = qResponses.map((r) => ({
      ...r,
      studentName: students[r.studentId]?.name ?? 'Unknown',
    }))
    const reveal = revealsByQuestionId.get(q.id) ?? null
    const qAnnotations: ResonanceReportQuestion['annotations'] = {}
    for (const r of qResponses) {
      const ann = annotations[r.id]
      if (ann !== undefined) qAnnotations[r.id] = ann
    }
    return { question: q, responses: enriched, reveal, annotations: qAnnotations }
  })

  return {
    version: 1,
    sessionId: session.id,
    exportedAt: Date.now(),
    students: Object.values(students),
    questions: questionSections,
  }
}

// ---------------------------------------------------------------------------
// HTML export
// ---------------------------------------------------------------------------

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0
}

function renderQuestionSection(sec: ResonanceReportQuestion): string {
  const { question, responses, reveal, annotations } = sec
  const hasCorrectOption = question.type === 'multiple-choice' && question.options.some((option) => option.isCorrect === true)
  const label =
    question.type === 'free-response'
      ? 'Free response'
      : !hasCorrectOption
        ? 'Poll'
        : 'Multiple choice'

  let body = ''

  if (question.type === 'multiple-choice') {
    const optionCounts = new Map<string, number>()
    for (const r of responses) {
      if (r.answer.type === 'multiple-choice') {
        for (const optionId of r.answer.selectedOptionIds) {
          optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1)
        }
      }
    }
    const correctIds = new Set(reveal?.correctOptionIds ?? [])
    body += '<table class="opts">'
    body += '<thead><tr><th>Option</th><th>Count</th><th>%</th></tr></thead><tbody>'
    for (const opt of question.options) {
      const count = optionCounts.get(opt.id) ?? 0
      const p = pct(count, responses.length)
      const isCorrect = correctIds.has(opt.id)
      body += `<tr${isCorrect ? ' class="correct"' : ''}>`
      body += `<td>${isCorrect ? '✓ ' : ''}${esc(opt.text)}</td>`
      body += `<td class="num">${count}</td>`
      body += `<td class="num">${p}%</td>`
      body += '</tr>'
    }
    body += '</tbody></table>'
  } else {
    if (responses.length === 0) {
      body += '<p class="empty">No responses.</p>'
    } else {
      body += '<ol class="responses">'
      for (const r of responses) {
        const ann = annotations[r.id]
        const text = r.answer.type === 'free-response' ? r.answer.text : '—'
        const annParts: string[] = []
        if (ann?.starred === true) annParts.push('★')
        if (ann?.flagged === true) annParts.push('⚑')
        if (ann?.emoji !== undefined && ann.emoji !== null) annParts.push(esc(ann.emoji))
        const annStr = annParts.length > 0 ? ` <span class="ann">${annParts.join(' ')}</span>` : ''
        body += `<li><span class="student">${esc(r.studentName)}</span>${annStr}: ${esc(text)}</li>`
      }
      body += '</ol>'
    }
  }

  if (reveal !== null && reveal.sharedResponses.length > 0) {
    body += '<p class="shared-label">Shared responses:</p><ul class="shared">'
    for (const sr of reveal.sharedResponses) {
      let text: string
      if (sr.answer.type === 'free-response') {
        text = sr.answer.text
      } else {
        const textParts = sr.answer.selectedOptionIds.map((selectedOptionId) =>
          question.type === 'multiple-choice'
            ? (question.options.find((opt) => opt.id === selectedOptionId)?.text ?? selectedOptionId)
            : selectedOptionId,
        )
        text = textParts.join(', ')
      }
      const emoji = sr.instructorEmoji !== null ? esc(sr.instructorEmoji) + ' ' : ''
      body += `<li>${emoji}${esc(text)}</li>`
    }
    body += '</ul>'
  }

  if (question.type === 'multiple-choice' && reveal?.correctOptionIds && reveal.correctOptionIds.length > 0) {
    const correctResponseCount = responses.filter((response) =>
      response.answer.type === 'multiple-choice' &&
      isMcqAnswerCorrect(response.answer.selectedOptionIds, reveal.correctOptionIds ?? []),
    ).length
    body += `<p class="mcq-meta">${correctResponseCount} correct response${correctResponseCount !== 1 ? 's' : ''}</p>`
  }

  const sharedTag = reveal !== null ? ' · <span class="shared-tag">Results shared</span>' : ''

  return `
    <section class="question">
      <header>
        <span class="type-label">${esc(label)}</span>
        <h2>${esc(question.text)}</h2>
        <p class="meta">${responses.length} response${responses.length !== 1 ? 's' : ''}${sharedTag}</p>
      </header>
      ${body}
    </section>`
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; font-size: 14px; color: #1f2937; background: #f9fafb; padding: 32px 24px; }
  .page { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; color: #111827; }
  .header-meta { color: #6b7280; font-size: 13px; margin-top: 6px; margin-bottom: 32px; }
  .question { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  .question header { margin-bottom: 14px; }
  .type-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; }
  h2 { font-size: 16px; font-weight: 600; margin: 4px 0 4px; }
  .meta { font-size: 12px; color: #6b7280; }
  .shared-tag { color: #16a34a; }
  table.opts { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.opts th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-weight: 500; }
  table.opts td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
  table.opts td.num { text-align: right; color: #374151; }
  table.opts tr.correct td { color: #15803d; font-weight: 500; }
  ol.responses { padding-left: 20px; }
  ol.responses li { padding: 4px 0; font-size: 13px; line-height: 1.5; }
  .student { font-weight: 500; color: #374151; }
  .ann { color: #f59e0b; }
  .empty { color: #9ca3af; font-style: italic; font-size: 13px; }
  .shared-label { font-size: 12px; color: #6b7280; margin-top: 14px; margin-bottom: 6px; font-weight: 500; }
  .mcq-meta { font-size: 12px; color: #6b7280; margin-top: 12px; }
  ul.shared { padding-left: 18px; }
  ul.shared li { font-size: 13px; padding: 2px 0; }
`

/**
 * Builds a self-contained HTML document for a Resonance session report.
 */
export function buildResonanceReportHtml(report: ResonanceReport): string {
  const exported = new Date(report.exportedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const questionHtml = report.questions.map(renderQuestionSection).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Resonance Report — ${esc(report.sessionId)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="page">
    <h1>Resonance Session Report</h1>
    <p class="header-meta">
      Session ${esc(report.sessionId)} &middot;
      Exported ${esc(exported)} &middot;
      ${report.students.length} student${report.students.length !== 1 ? 's' : ''} &middot;
      ${report.questions.length} question${report.questions.length !== 1 ? 's' : ''}
    </p>
    ${questionHtml}
  </div>
</body>
</html>`
}

/**
 * Generates a safe filename for the HTML report download.
 */
export function buildResonanceReportFilename(sessionId: string): string {
  const safeSessionId = sessionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

  const date = new Date().toISOString().slice(0, 10)
  return `resonance-report-${safeSessionId || 'session'}-${date}.html`
}
