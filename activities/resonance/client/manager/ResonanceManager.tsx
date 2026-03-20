import { useParams } from 'react-router-dom'

export default function ResonanceManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Resonance</h1>
      {sessionId ? (
        <p className="text-gray-600">Session: {sessionId}</p>
      ) : (
        <p className="text-gray-600">No active session.</p>
      )}
      <p className="mt-4 text-sm text-gray-400">[Instructor manager — coming soon]</p>
    </div>
  )
}
