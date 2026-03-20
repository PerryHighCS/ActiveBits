import { useState } from 'react'

interface Props {
  onSubmit(text: string): void | Promise<void>
  onDraftChange?(text: string): void
  submitting?: boolean
  submitted?: boolean
}

export default function FreeResponseInput({ onSubmit, onDraftChange, submitting = false, submitted = false }: Props) {
  const [text, setText] = useState('')
  const canSubmit = !submitting && !submitted && text.trim().length > 0

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit(text.trim())
  }

  if (submitted) {
    return (
      <p className="text-sm text-gray-500 italic" aria-live="polite">
        Answer submitted — waiting for the instructor to continue.
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
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
        rows={4}
        maxLength={2000}
        disabled={submitting}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        aria-busy={submitting}
        aria-disabled={!canSubmit}
        className="w-full rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit answer'}
      </button>
    </form>
  )
}
