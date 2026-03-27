export function normalizeTeacherJoinSessionId(sessionIdInput: string): string {
  return sessionIdInput.trim().toLowerCase()
}

export function getTeacherJoinInitialSessionId(sessionIdInput: string): string {
  return normalizeTeacherJoinSessionId(sessionIdInput)
}

export function normalizeTeacherJoinCode(teacherCode: string): string {
  return teacherCode.trim()
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
