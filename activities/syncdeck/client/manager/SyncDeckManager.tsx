import type { FC } from 'react'
import { useParams } from 'react-router-dom'

const SyncDeckManager: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()

  if (!sessionId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">Create a live session or a permanent link to begin.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-3">
      <h1 className="text-2xl font-bold">SyncDeck Manager</h1>
      <p className="text-sm text-gray-700">Session {sessionId}</p>
      <p className="text-sm text-gray-700">Presentation sync controls will be added in the next implementation pass.</p>
    </div>
  )
}

export default SyncDeckManager
