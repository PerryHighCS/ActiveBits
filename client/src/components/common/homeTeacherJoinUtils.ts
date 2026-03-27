export function getTeacherJoinInitialSessionId(sessionIdInput: string): string {
  return sessionIdInput.trim().toLowerCase()
}

export function getTeacherJoinClosedState(): {
  sessionId: string
  teacherCode: string
  error: null
} {
  return {
    sessionId: '',
    teacherCode: '',
    error: null,
  }
}
