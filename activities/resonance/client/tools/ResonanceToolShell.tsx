import { useState } from 'react'
import type { Question } from '../../shared/types.js'
import type { MCQQuestion } from '../../shared/types.js'
import QuestionBuilder from './QuestionBuilder.js'
import QuestionCard from './QuestionCard.js'
import ResonanceQuestionSetUploader from './ResonanceQuestionSetUploader.js'
import ResonanceReport from './ResonanceReport.js'

type Tab = 'builder' | 'report'

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, filename)
}

export function isGimkitCsvExportCompatibleQuestion(question: Question): question is MCQQuestion {
  if (question.type !== 'multiple-choice') {
    return false
  }

  return question.options.filter((option) => option.isCorrect === true).length === 1
}

export function questionsToCsv(questions: Question[]): string {
  const rows: string[] = [
    'Resonance Question Set Export',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
  ]
  for (const q of questions) {
    if (!isGimkitCsvExportCompatibleQuestion(q)) {
      continue
    }

    const correct = q.options.find((o) => o.isCorrect)
    const incorrect = q.options.filter((o) => !o.isCorrect)
    const cells = [
      q.text,
      correct?.text ?? '',
      incorrect[0]?.text ?? '',
      incorrect[1]?.text ?? '',
      incorrect[2]?.text ?? '',
    ].map((c) => `"${c.replace(/"/g, '""')}"`)
    rows.push(cells.join(','))
  }
  return rows.join('\n')
}

function downloadCSV(questions: Question[], filename: string) {
  const csv = questionsToCsv(questions)
  const blob = new Blob([csv], { type: 'text/csv' })
  downloadBlob(blob, filename)
}

// ---------------------------------------------------------------------------
// Question set panel
// ---------------------------------------------------------------------------

function QuestionSetPanel() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [buildingNew, setBuildingNew] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const gimkitCsvCompatibleCount = questions.filter(isGimkitCsvExportCompatibleQuestion).length

  function moveQuestion(from: number, to: number) {
    setQuestions((qs) => {
      const next = [...qs]
      const moved = next.splice(from, 1)[0]
      if (moved !== undefined) next.splice(to, 0, moved)
      return next.map((q, i) => ({ ...q, order: i }))
    })
  }

  function removeQuestion(id: string) {
    setQuestions((qs) => qs.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i })))
  }

  function saveQuestion(q: Question) {
    setQuestions((qs) => {
      const idx = qs.findIndex((existing) => existing.id === q.id)
      if (idx !== -1) {
        const next = [...qs]
        next[idx] = q
        return next
      }
      return [...qs, { ...q, order: qs.length }]
    })
    setBuildingNew(false)
    setEditingId(null)
  }

  const editTarget = editingId !== null ? (questions.find((q) => q.id === editingId) ?? null) : null

  return (
    <div className="space-y-4">
      {/* Import */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Import question set</p>
        <ResonanceQuestionSetUploader
          onQuestionsChanged={(imported) => {
            if (imported !== null) setQuestions(imported.map((q, i) => ({ ...q, order: i })))
          }}
        />
      </div>

      {/* Question list */}
      {questions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              {questions.length} question{questions.length !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => downloadJSON(questions, 'resonance-questions.json')}
                className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => downloadCSV(questions, 'resonance-questions.csv')}
                disabled={gimkitCsvCompatibleCount === 0}
                aria-disabled={gimkitCsvCompatibleCount === 0}
                className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1"
              >
                Export CSV
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Gimkit CSV export includes only multiple-choice questions with exactly one correct answer.
          </p>

          {questions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={idx}
              onRemove={() => removeQuestion(q.id)}
              onEdit={() => {
                setBuildingNew(false)
                setEditingId(q.id)
              }}
              onMoveUp={idx > 0 ? () => moveQuestion(idx, idx - 1) : undefined}
              onMoveDown={idx < questions.length - 1 ? () => moveQuestion(idx, idx + 1) : undefined}
            />
          ))}
        </div>
      )}

      {/* Builder / Edit form */}
      {(buildingNew || editingId !== null) && (
        <QuestionBuilder
          editTarget={editTarget}
          nextOrder={questions.length}
          onSave={saveQuestion}
          onCancel={() => {
            setBuildingNew(false)
            setEditingId(null)
          }}
        />
      )}

      {!buildingNew && editingId === null && (
        <button
          type="button"
          onClick={() => setBuildingNew(true)}
          className="w-full rounded-lg border-2 border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          + Add question
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResonanceToolShell
// ---------------------------------------------------------------------------

/**
 * Main shell for /util/resonance — hosts the question set builder/import/export
 * and the session report viewer. Accessible from the manage dashboard via the
 * Resonance Tools utility link.
 */
export default function ResonanceToolShell() {
  const [activeTab, setActiveTab] = useState<Tab>('builder')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'builder', label: 'Question builder' },
    { id: 'report', label: 'Session report' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Resonance Tools</h1>
          <p className="text-gray-500 text-sm mt-1">
            Build question sets, import/export, and review session reports.
          </p>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 mb-6" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`resonance-tab-${tab.id}`}
              id={`resonance-tab-btn-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div
          id="resonance-tab-builder"
          role="tabpanel"
          aria-labelledby="resonance-tab-btn-builder"
          hidden={activeTab !== 'builder'}
        >
          <QuestionSetPanel />
        </div>

        <div
          id="resonance-tab-report"
          role="tabpanel"
          aria-labelledby="resonance-tab-btn-report"
          hidden={activeTab !== 'report'}
        >
          <ResonanceReport />
        </div>
      </div>
    </div>
  )
}
