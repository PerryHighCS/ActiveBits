import { useState } from 'react'
import { MAX_MCQ_OPTIONS, type MCQOption, type Question } from '../../shared/types.js'

type QuestionDraft =
  | { type: 'free-response'; text: string; timeLimitMs: number | null }
  | { type: 'multiple-choice'; text: string; timeLimitMs: number | null; options: OptionDraft[] }

interface OptionDraft {
  id: string
  text: string
  isCorrect: boolean
}

function emptyDraft(): QuestionDraft {
  return {
    type: 'free-response',
    text: '',
    timeLimitMs: null,
  }
}

function draftFromQuestion(q: Question): QuestionDraft {
  if (q.type === 'free-response') {
    return { type: 'free-response', text: q.text, timeLimitMs: q.responseTimeLimitMs ?? null }
  }
  return {
    type: 'multiple-choice',
    text: q.text,
    timeLimitMs: q.responseTimeLimitMs ?? null,
    options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect ?? false })),
  }
}

function draftToQuestion(draft: QuestionDraft, id: string, order: number): Question {
  const base = {
    id,
    text: draft.text.trim(),
    order,
    ...(draft.timeLimitMs !== null ? { responseTimeLimitMs: draft.timeLimitMs } : {}),
  }
  if (draft.type === 'free-response') {
    return { ...base, type: 'free-response' }
  }
  const options: MCQOption[] = draft.options
    .filter((o) => o.text.trim().length > 0)
    .map((o) => ({
      id: o.id,
      text: o.text.trim(),
      ...(o.isCorrect ? { isCorrect: true } : {}),
    }))
  return { ...base, type: 'multiple-choice', options }
}

export function newOptionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `opt_${crypto.randomUUID()}`
  }

  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function newQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `q_${crypto.randomUUID()}`
  }

  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function defaultOptions(): OptionDraft[] {
  return [
    { id: newOptionId(), text: '', isCorrect: false },
    { id: newOptionId(), text: '', isCorrect: false },
  ]
}

interface Props {
  /** When provided, the builder is in edit mode for this question. */
  editTarget?: Question | null
  nextOrder: number
  onSave(question: Question): void
  onCancel(): void
}

/**
 * Inline form for creating or editing a question with optional time limit.
 * Supports both free-response and multiple-choice types (including poll mode).
 */
export default function QuestionBuilder({ editTarget, nextOrder, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<QuestionDraft>(
    editTarget !== undefined && editTarget !== null ? draftFromQuestion(editTarget) : emptyDraft(),
  )
  const isEdit = editTarget !== null && editTarget !== undefined

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const textOk = draft.text.trim().length > 0
  const optionsOk =
    draft.type !== 'multiple-choice' ||
    draft.options.filter((o) => o.text.trim().length > 0).length >= 2
  const canSave = textOk && optionsOk

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function setType(type: QuestionDraft['type']) {
    if (type === 'free-response') {
      setDraft((d) => ({ type: 'free-response', text: d.text, timeLimitMs: d.timeLimitMs }))
    } else {
      setDraft((d) => ({
        type: 'multiple-choice',
        text: d.text,
        timeLimitMs: d.timeLimitMs,
        options:
          d.type === 'multiple-choice' && d.options.length > 0 ? d.options : defaultOptions(),
      }))
    }
  }

  function setOption(id: string, patch: Partial<OptionDraft>) {
    if (draft.type !== 'multiple-choice') return
    setDraft((d) => {
      if (d.type !== 'multiple-choice') return d
      return {
        ...d,
        options: d.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }
    })
  }

  function addOption() {
    if (draft.type !== 'multiple-choice') return
    setDraft((d) => {
      if (d.type !== 'multiple-choice') return d
      if (d.options.length >= MAX_MCQ_OPTIONS) return d
      return { ...d, options: [...d.options, { id: newOptionId(), text: '', isCorrect: false }] }
    })
  }

  function removeOption(id: string) {
    if (draft.type !== 'multiple-choice') return
    setDraft((d) => {
      if (d.type !== 'multiple-choice') return d
      return { ...d, options: d.options.filter((o) => o.id !== id) }
    })
  }

  function setCorrect(id: string) {
    if (draft.type !== 'multiple-choice') return
    setDraft((d) => {
      if (d.type !== 'multiple-choice') return d
      return {
        ...d,
        options: d.options.map((o) => (o.id === id ? { ...o, isCorrect: !o.isCorrect } : o)),
      }
    })
  }

  function handleSave() {
    if (!canSave) return
    const id = editTarget?.id ?? newQuestionId()
    const order = editTarget?.order ?? nextOrder
    onSave(draftToQuestion(draft, id, order))
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-700">{isEdit ? 'Edit question' : 'New question'}</p>

      {/* Type selector */}
      <div className="flex gap-2">
        {(['free-response', 'multiple-choice'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={draft.type === t}
            onClick={() => setType(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              draft.type === t
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            {t === 'free-response' ? 'Free response' : 'Multiple choice'}
          </button>
        ))}
      </div>

      {/* Question text */}
      <div>
        <label htmlFor="qb-text" className="block text-xs font-medium text-gray-600 mb-1">
          Question
        </label>
        <textarea
          id="qb-text"
          value={draft.text}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          placeholder="Type your question…"
          rows={2}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* MCQ options */}
      {draft.type === 'multiple-choice' && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">
            Options{' '}
            <span className="text-gray-400 font-normal">
              — click ✓ to toggle any correct answers, or leave all blank for poll mode
            </span>
          </p>
          <div className="space-y-1.5">
            {draft.options.map((opt, idx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={opt.isCorrect ? 'Unmark as correct' : 'Mark as correct answer'}
                  aria-pressed={opt.isCorrect}
                  onClick={() => setCorrect(opt.id)}
                  className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                    opt.isCorrect
                      ? 'border-green-500 bg-green-500 text-white'
                      : 'border-gray-200 text-gray-300 hover:border-gray-400'
                  }`}
                >
                  ✓
                </button>
                <input
                  type="text"
                  value={opt.text}
                  onChange={(e) => setOption(opt.id, { text: e.target.value })}
                  placeholder={`Option ${idx + 1}`}
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
                  aria-label={`Option ${idx + 1} text`}
                />
                {draft.options.length > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove option ${idx + 1}`}
                    onClick={() => removeOption(opt.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {draft.options.length < MAX_MCQ_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-xs text-blue-600 hover:text-blue-700"
            >
              + Add option
            </button>
          )}
        </div>
      )}

      {/* Time limit */}
      <div>
        <label htmlFor="qb-timelimit" className="block text-xs font-medium text-gray-600 mb-1">
          Response time limit (seconds){' '}
          <span className="text-gray-400 font-normal">— leave blank for no limit</span>
        </label>
        <input
          id="qb-timelimit"
          type="number"
          min={5}
          max={600}
          value={draft.timeLimitMs !== null ? draft.timeLimitMs / 1000 : ''}
          onChange={(e) => {
            const val = e.target.value === '' ? null : parseInt(e.target.value, 10) * 1000
            setDraft((d) => ({ ...d, timeLimitMs: val !== null && !isNaN(val) ? val : null }))
          }}
          placeholder="No limit"
          className="w-32 rounded border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isEdit ? 'Save changes' : 'Add question'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
