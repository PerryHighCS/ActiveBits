export async function requestStudentReturn(params: {
  sessionId: string
  studentId: string
  studentName: string
  instructorPasscode: string
  confirm: (message: string) => boolean
  fetchImpl: typeof fetch
}): Promise<'cancelled' | 'returned' | 'failed'> {
  if (!params.confirm(`Return ${params.studentName} to the waiting room?`)) return 'cancelled'
  try {
    const response = await params.fetchImpl(`/api/syncdeck/${encodeURIComponent(params.sessionId)}/students/${encodeURIComponent(params.studentId)}/return-to-waiting-room`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instructorPasscode: params.instructorPasscode }),
    })
    return response.ok ? 'returned' : 'failed'
  } catch { return 'failed' }
}
