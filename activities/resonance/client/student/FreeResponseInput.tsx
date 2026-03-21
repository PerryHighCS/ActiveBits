import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'

interface Props {
  value?: string
  onSubmit(text: string): void | Promise<void>
  onDraftChange?(text: string): void
  submitting?: boolean
  submitted?: boolean
}

export default function FreeResponseInput({
  value = '',
  onSubmit,
  onDraftChange,
  submitting = false,
  submitted = false,
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
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        aria-busy={submitting}
        aria-disabled={!canSubmit}
        className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit answer'}
      </button>
    </form>
  )
}
