import { useState } from 'react'

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Join Resonance</h1>
        <p className="text-sm text-gray-500 mb-5">Enter your name to join the session.</p>

        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="resonance-student-name"
              className="block text-sm font-medium text-gray-700 mb-1"
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
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              aria-describedby={error !== null ? 'resonance-name-error' : undefined}
              disabled={submitting}
            />
          </div>

          {error !== null && (
            <p id="resonance-name-error" className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            aria-disabled={!canSubmit}
            className="w-full rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Joining…' : 'Join session'}
          </button>
        </form>
      </div>
    </div>
  )
}
