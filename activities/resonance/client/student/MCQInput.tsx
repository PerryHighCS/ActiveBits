import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { StudentMCQOption } from '../../shared/types.js'

interface Props {
  options: StudentMCQOption[]
  value?: string | null
  onSubmit(selectedOptionId: string): void | Promise<void>
  onDraftChange?(selectedOptionId: string | null): void
  submitting?: boolean
  submitted?: boolean
}

export default function MCQInput({
  options,
  value = null,
  onSubmit,
  onDraftChange,
  submitting = false,
  submitted = false,
}: Props) {
  const [selected, setSelected] = useState<string | null>(value)
  const canSubmit = !submitting && !submitted && selected !== null

  useEffect(() => {
    setSelected(value)
  }, [value])

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit || selected === null) return
    await onSubmit(selected)
  }

  if (submitted && selected !== null) {
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
      <fieldset>
        <legend className="sr-only">Choose an answer</legend>
        <div className="space-y-2">
          {options.map((option) => {
            const isSelected = selected === option.id
            return (
              <label
                key={option.id}
                className={`flex items-start gap-3 rounded-lg border-2 px-4 py-3 cursor-pointer transition-colors ${
                  isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                } ${submitting || submitted ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="resonance-mcq"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => {
                    setSelected(option.id)
                    onDraftChange?.(option.id)
                  }}
                  disabled={submitting || submitted}
                  className="mt-0.5 accent-blue-600"
                  aria-label={option.text}
                />
                <span className="text-sm text-gray-800">{option.text}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

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
