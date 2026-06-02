import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'

interface Props {
  value?: string
  onSubmit(text: string): void | Promise<void>
  onDraftChange?(text: string): void
  submitting?: boolean
  submitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
}

export default function FreeResponseInput({
  value = '',
  onSubmit,
  onDraftChange,
  submitting = false,
  submitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
}: Props) {
  const [text, setText] = useState(value)
  const canSubmit = !submitting && !submitted && text.trim().length > 0

  useEffect(() => {
    setText(value)
  }, [value])

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit(text.trim())
  }

  if (submitted) {
    return (
      <div
        className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-center gap-3"
        {...(announceSubmittedMessage ? { 'aria-live': 'polite' as const } : {})}
      >
        <svg
          className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{submittedMessage}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e) }}
      className="space-y-3"
    >
      <label htmlFor="resonance-fr-input" className="sr-only">
        Your answer
      </label>
      <textarea
        id="resonance-fr-input"
        value={text}
        onChange={(e) => {
          const nextValue = e.target.value
          setText(nextValue)
          onDraftChange?.(nextValue)
        }}
        placeholder="Type your answer…"
        rows={5}
        maxLength={2000}
        disabled={submitting}
        className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 px-4 py-3 text-base resize-none focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40 transition-all"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{text.length} / 2000</span>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={submitting}
          aria-disabled={!canSubmit}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
        >
          {submitting ? 'Submitting…' : 'Submit answer →'}
        </button>
      </div>
    </form>
  )
}
