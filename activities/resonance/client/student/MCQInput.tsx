import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { MCQSelectionMode, StudentMCQOption } from '../../shared/types.js'
import FormattedMarkdown, { plainTextFromMarkdown } from '../components/FormattedMarkdown.js'

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

  const isMultiple = selectionMode === 'multiple'

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e) }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="sr-only">
          {isMultiple ? 'Choose one or more answers' : 'Choose an answer'}
        </legend>
        <div className="space-y-2.5">
          {options.map((option) => {
            const isSelected = selected.includes(option.id)
            const isDisabled = submitting || submitted

            return (
              <label
                key={option.id}
                className={[
                  'flex items-start gap-4 rounded-xl border-2 px-5 py-4 transition-all focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-900/40',
                  isDisabled ? 'pointer-events-none opacity-60' : 'cursor-pointer',
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-500'
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/20',
                ].join(' ')}
              >
                {/* Custom indicator */}
                <div
                  className={[
                    'mt-0.5 flex-shrink-0 transition-all',
                    isMultiple
                      ? `w-5 h-5 rounded flex items-center justify-center border-2 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500'
                            : 'border-slate-300 dark:border-slate-500'
                        }`
                      : `w-5 h-5 rounded-full flex items-center justify-center border-2 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500'
                            : 'border-slate-300 dark:border-slate-500'
                        }`,
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isSelected && (
                    isMultiple ? (
                      <svg className="w-3 h-3 text-white" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )
                  )}
                </div>

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
                  disabled={isDisabled}
                  className="sr-only"
                  aria-label={plainTextFromMarkdown(option.text) || `Option ${option.id}`}
                />
                <FormattedMarkdown
                  markdown={option.text}
                  variant="inline"
                  className={`min-w-0 flex-1 text-base leading-snug ${isSelected ? 'font-medium text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-300'}`}
                />
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
        className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
      >
        {submitting ? 'Submitting…' : isMultiple ? 'Submit answers →' : 'Submit answer →'}
      </button>
    </form>
  )
}
