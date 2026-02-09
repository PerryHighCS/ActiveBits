import type { QuestionType, PythonListPracticeStats } from '../pythonListPracticeTypes.js'

const VALID_QUESTION_TYPES = new Set<QuestionType>([
  'all',
  'index-get',
  'index-set',
  'len',
  'append',
  'remove',
  'insert',
  'pop',
  'for-range',
  'range-len',
  'for-each',
])

export function sanitizeQuestionTypes(types: unknown): QuestionType[] {
  if (!Array.isArray(types)) {
    return ['all']
  }

  const cleaned = (types as unknown[])
    .filter((t): t is string => typeof t === 'string' && VALID_QUESTION_TYPES.has(t as QuestionType))
    .slice(0, VALID_QUESTION_TYPES.size)

  if (cleaned.length === 0) {
    return ['all']
  }

  if (cleaned.length > 1 && cleaned.includes('all')) {
    return ['all']
  }

  return cleaned as QuestionType[]
}

export function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null
  const trimmed = name.trim().slice(0, 50)
  if (trimmed.length === 0) return null
  const ok = /^[a-zA-Z0-9\s\-'.]+$/.test(trimmed)
  return ok ? trimmed : null
}

export function validateStats(stats: unknown): PythonListPracticeStats | null {
  if (stats == null || typeof stats !== 'object') return null

  const clampInt = (val: unknown, max = 100000): number => {
    const n = parseInt(String(val), 10)
    if (Number.isNaN(n) || n < 0 || n > max) return 0
    return n
  }

  const statsObj = stats as Record<string, unknown>
  const sanitized: PythonListPracticeStats = {
    total: clampInt(statsObj.total),
    correct: clampInt(statsObj.correct),
    streak: clampInt(statsObj.streak, 10000),
    longestStreak: clampInt(statsObj.longestStreak, 10000),
  }

  if (sanitized.correct > sanitized.total) sanitized.correct = sanitized.total
  if (sanitized.longestStreak < sanitized.streak) sanitized.longestStreak = sanitized.streak

  return sanitized
}

export function validateStudentId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const trimmed = value.trim().slice(0, 80)
  if (trimmed.length === 0) return null
  if (!/^[a-zA-Z0-9._:/-]+$/.test(trimmed)) return null
  return trimmed
}
