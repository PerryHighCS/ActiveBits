import { useState } from 'react'
import Button from '@src/components/ui/Button'

interface RegistrationFormProps {
  sessionId: string
  initialName?: string
  initialParticipantId?: string | null
  onRegistered: (participantId: string, name: string, token: string) => void
}

export default function RegistrationForm({
  sessionId,
  initialName = '',
  initialParticipantId,
  onRegistered,
}: RegistrationFormProps) {
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/commissioned-ideas/${sessionId}/register-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, participantId: initialParticipantId }),
      })
      const data = (await res.json()) as { participantId?: string; name?: string; token?: string; error?: string }

      if (!res.ok || !data.participantId || !data.token) {
        setError(data.error ?? 'Could not join. Please try again.')
        return
      }

      onRegistered(data.participantId, data.name ?? trimmed, data.token)
    } catch {
      setError('Network error — could not join session')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Join Session</h1>
        <p className="text-gray-500 text-sm mb-6">Enter your name to join the activity.</p>

        <form onSubmit={(e) => { void handleSubmit(e) }} noValidate>
          <label htmlFor="ci-name" className="block text-sm font-medium text-gray-700 mb-1">
            Your name
          </label>
          <input
            id="ci-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            autoComplete="off"
            disabled={submitting}
            aria-describedby={error ? 'ci-name-error' : undefined}
            aria-invalid={Boolean(error)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:opacity-50 mb-4"
            placeholder="First Last"
          />

          {error && (
            <p id="ci-name-error" role="alert" className="text-sm text-red-600 mb-3">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="w-full"
          >
            {submitting ? 'Joining…' : 'Join'}
          </Button>
        </form>
      </div>
    </div>
  )
}
