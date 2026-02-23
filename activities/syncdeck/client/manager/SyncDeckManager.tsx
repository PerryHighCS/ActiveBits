import { useState, type FC } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

const SyncDeckManager: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const [copiedValue, setCopiedValue] = useState<string | null>(null)

  const studentJoinUrl = sessionId && typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : ''

  const copyValue = async (value: string): Promise<void> => {
    if (!value || typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      return
    }

    await navigator.clipboard.writeText(value)
    setCopiedValue(value)
    setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1500)
  }

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('End this session? All students will be disconnected.')
      if (!confirmed) return
    }

    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  if (!sessionId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">Create a live session or a permanent link to begin.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 w-full">
        <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-2xl font-bold text-gray-800">SyncDeck</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Join Code:</span>
              <code
                onClick={() => {
                  void copyValue(sessionId)
                }}
                className="px-3 py-1.5 rounded bg-gray-100 font-mono text-lg font-semibold text-gray-800 cursor-pointer hover:bg-gray-200 transition-colors"
                title="Click to copy"
              >
                {copiedValue === sessionId ? '✓ Copied!' : sessionId}
              </code>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void copyValue(studentJoinUrl)
              }}
              className="px-3 py-2 rounded border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copiedValue === studentJoinUrl ? '✓ Copied!' : 'Copy Join URL'}
            </button>

            <button
              onClick={() => {
                void handleEndSession()
              }}
              className="px-3 py-2 rounded border border-red-600 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              End Session
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-3">
      <p className="text-sm text-gray-700">Presentation sync controls will be added in the next implementation pass.</p>
      </div>
    </div>
  )
}

export default SyncDeckManager
