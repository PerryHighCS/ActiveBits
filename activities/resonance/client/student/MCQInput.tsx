import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { MCQSelectionMode, StudentMCQOption } from '../../shared/types.js'

interface Props {
  options: StudentMCQOption[]
  selectionMode: MCQSelectionMode
  value?: string[]
  onSubmit(selectedOptionIds: string[]): void | Promise<void>
  onDraftChange?(selectedOptionIds: string[]): void
  submitting?: boolean
  submitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
}

export function getMcqInputControlType(selectionMode: MCQSelectionMode): 'checkbox' | 'radio' {
  return selectionMode === 'multiple' ? 'checkbox' : 'radio'
}

export function toggleMcqSelection(
  selectionMode: MCQSelectionMode,
  selectedOptionIds: readonly string[],
  optionId: string,
): string[] {
  if (selectionMode !== 'multiple') {
    return [optionId]
  }

  return selectedOptionIds.includes(optionId)
    ? selectedOptionIds.filter((selectedId) => selectedId !== optionId)
    : [...selectedOptionIds, optionId]
}

export default function MCQInput({
  options,
  selectionMode,
  value = [],
  onSubmit,
  onDraftChange,
  submitting = false,
  submitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
}: Props) {
  const [selected, setSelected] = useState<string[]>(value)
  const canSubmit = !submitting && !submitted && selected.length > 0

  useEffect(() => {
    setSelected(value)
  }, [value])

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit(selected)
  }

  if (submitted && selected.length > 0) {
    return (
      <p
        className="text-sm text-gray-500 italic"
        {...(announceSubmittedMessage ? { 'aria-live': 'polite' as const } : {})}
      >
        {submittedMessage}
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
        <legend className="sr-only">
          {selectionMode === 'multiple' ? 'Choose one or more answers' : 'Choose an answer'}
        </legend>
        <div className="space-y-2">
          {options.map((option) => {
            const isSelected = selected.includes(option.id)
            return (
              <label
                key={option.id}
                className={`flex items-start gap-3 rounded-lg border-2 px-4 py-3 cursor-pointer transition-colors ${
                  isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                } ${submitting || submitted ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  type={getMcqInputControlType(selectionMode)}
                  name="resonance-mcq"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => {
                    const nextSelected = toggleMcqSelection(selectionMode, selected, option.id)
                    setSelected(nextSelected)
                    onDraftChange?.(nextSelected)
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
        {submitting ? 'Submitting…' : selectionMode === 'multiple' ? 'Submit answers' : 'Submit answer'}
      </button>
    </form>
  )
}
