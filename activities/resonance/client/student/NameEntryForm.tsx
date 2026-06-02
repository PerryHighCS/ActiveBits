import { useState } from 'react'
import type { SubmitEvent } from 'react'

interface Props {
  sessionId: string
  onRegistered(studentId: string, name: string): void
}

/**
 * Fallback name-entry form shown when the platform waiting room did not
 * collect a display name (e.g. direct URL access without the entry flow).
 */
export default function NameEntryForm({ sessionId, onRegistered }: Props) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const canSubmit = !submitting && trimmedName.length > 0 && trimmedName.length <= 80

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/register-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      const data = (await resp.json()) as { studentId?: string; name?: string; error?: string }

      if (!resp.ok || !data.studentId) {
        setError(data.error ?? 'Registration failed — please try again')
        setSubmitting(false)
        return
      }

      onRegistered(data.studentId, data.name ?? trimmedName)
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-xl bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-10">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-indigo-600 dark:text-indigo-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 text-center mb-1.5">
          Join Resonance
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-center mb-8">
          Enter your name to join the session
        </p>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="resonance-student-name"
              className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2"
            >
              Your name
            </label>
            <input
              id="resonance-student-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              maxLength={80}
              autoComplete="name"
              autoFocus
              className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 px-4 py-3.5 text-base focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40 transition-all"
              aria-describedby={error !== null ? 'resonance-name-error' : undefined}
              disabled={submitting}
            />
          </div>

          {error !== null && (
            <p id="resonance-name-error" className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            aria-disabled={!canSubmit}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
          >
            {submitting ? 'Joining…' : 'Join session →'}
          </button>
        </form>
      </div>
    </div>
  )
}
