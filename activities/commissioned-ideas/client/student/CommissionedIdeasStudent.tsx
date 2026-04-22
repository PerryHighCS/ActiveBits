interface SessionData {
  sessionId?: string
  data?: Record<string, unknown>
}

export default function CommissionedIdeasStudent({ sessionData }: { sessionData: SessionData }) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Commissioned Ideas</h2>
      <p className="text-gray-500">
        Student view coming in Phase 2+
      </p>
      {sessionData?.sessionId && (
        <p className="mt-2 text-sm font-mono text-gray-400">Session: {sessionData.sessionId}</p>
      )}
    </div>
  )
}
