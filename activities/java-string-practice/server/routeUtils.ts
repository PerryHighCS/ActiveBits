import type { JavaStringMethodId, JavaStringStats } from '../javaStringPracticeTypes.js'

const validMethods = new Set<JavaStringMethodId>(['all', 'substring', 'indexOf', 'equals', 'length', 'compareTo'])

/**
 * Validate and sanitize a student name.
 */
export function validateStudentName(name: unknown): string | null {
  if (!name || typeof name !== 'string') {
    return null
  }

  const sanitized = name.trim().slice(0, 50)
  if (sanitized.length === 0) {
    return null
  }

  const validPattern = /^[a-zA-Z0-9\s\-'.]+$/
  return validPattern.test(sanitized) ? sanitized : null
}

/**
 * Validate and sanitize a stats payload.
 */
export function validateStats(stats: unknown): JavaStringStats | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return null
  }

  const statsRecord = stats as Record<string, unknown>
  const validateInt = (value: unknown, max = 100_000): number => {
    const num = Number.parseInt(String(value), 10)
    if (Number.isNaN(num) || num < 0 || num > max) {
      return 0
    }
    return num
  }

  const sanitized: JavaStringStats = {
    total: validateInt(statsRecord.total),
    correct: validateInt(statsRecord.correct),
    streak: validateInt(statsRecord.streak, 10_000),
    longestStreak: validateInt(statsRecord.longestStreak, 10_000),
  }

  if (sanitized.correct > sanitized.total) {
    sanitized.correct = sanitized.total
  }

  if (sanitized.longestStreak < sanitized.streak) {
    sanitized.longestStreak = sanitized.streak
  }

  return sanitized
}

/**
 * Validate method selection payload.
 */
export function validateMethods(methods: unknown): JavaStringMethodId[] | null {
  if (!methods || !Array.isArray(methods)) {
    return null
  }

  const sanitized = methods
    .filter((method): method is JavaStringMethodId => typeof method === 'string' && validMethods.has(method as JavaStringMethodId))
    .slice(0, 10)

  return sanitized.length > 0 ? sanitized : ['all']
}
