import { useRef, useState } from 'react'
import type { Question } from '../../shared/types.js'
import { parseGimkitCSV, validateQuestionSet } from '../../shared/validation.js'

interface Props {
  /** Called whenever the parsed question set changes. Null means no valid set. */
  onQuestionsChanged(questions: Question[] | null): void
  /** Pre-populate with an existing question set (e.g. edit mode). */
  initialQuestions?: Question[] | null
}

interface ParseResult {
  questions: Question[]
  errors: string[]
}

export function parseFile(file: File, text: string): ParseResult {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return parseGimkitCSV(text)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { questions: [], errors: ['Could not parse JSON — check that the file is valid JSON'] }
  }

  if (!Array.isArray(raw)) {
    return { questions: [], errors: ['JSON file must contain an array of questions'] }
  }

  return validateQuestionSet(raw)
}

/**
 * Shared question-set upload component for JSON and Gimkit-compatible CSV files.
 * Used by both the session-creation flow and the persistent-link builder.
 */
export default function ResonanceQuestionSetUploader({ onQuestionsChanged, initialQuestions }: Props) {
  const [questions, setQuestions] = useState<Question[] | null>(initialQuestions ?? null)
  const [errors, setErrors] = useState<string[]>([])
  const [filename, setFilename] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    setFilename(file.name)
    const reader = new FileReader()

    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') {
        setErrors(['Could not read file'])
        setQuestions(null)
        onQuestionsChanged(null)
        return
      }

      const result = parseFile(file, text)
      setErrors(result.errors)

      if (result.questions.length > 0) {
        setQuestions(result.questions)
        onQuestionsChanged(result.questions)
      } else {
        setQuestions(null)
        onQuestionsChanged(null)
      }
    }

    reader.onerror = () => {
      setErrors(['Failed to read file'])
      setQuestions(null)
      onQuestionsChanged(null)
    }

    reader.readAsText(file)
  }

  const hasErrors = errors.length > 0
  const questionCount = questions?.length ?? 0
  const hasPartialErrors = hasErrors && questionCount > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label
          htmlFor="resonance-question-file"
          className="cursor-pointer inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Choose file
        </label>
        <input
          ref={inputRef}
          id="resonance-question-file"
          type="file"
          accept=".json,.csv"
          aria-label="Upload question set — accepts JSON or Gimkit CSV format"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        <span className="text-sm text-gray-500">
          {filename ?? 'No file chosen — JSON or Gimkit CSV'}
        </span>
      </div>

      {/* Validation errors */}
      {hasErrors && (
        <ul
          className="text-sm text-red-600 space-y-0.5"
          role="alert"
          aria-label={`${errors.length} validation error${errors.length !== 1 ? 's' : ''}`}
        >
          {errors.map((err, i) => (
            <li key={i}>• {err}</li>
          ))}
        </ul>
      )}

      {/* Question preview */}
      {questionCount > 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <p className="font-medium text-gray-700">
            {questionCount} question{questionCount !== 1 ? 's' : ''} loaded
            {hasPartialErrors && (
              <span className="ml-1 text-amber-600">
                ({errors.length} row{errors.length !== 1 ? 's' : ''} skipped)
              </span>
            )}
          </p>
          <ol className="mt-1 space-y-0.5 text-gray-500 list-decimal list-inside">
            {questions!.slice(0, 3).map((q) => (
              <li key={q.id} className="truncate">
                {q.text}
                <span className="ml-1 text-gray-400 text-xs">({q.type})</span>
              </li>
            ))}
            {questionCount > 3 && (
              <li className="text-gray-400">…and {questionCount - 3} more</li>
            )}
          </ol>
        </div>
      )}
    </div>
  )
}
