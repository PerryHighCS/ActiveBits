import type { JavaFormatDifficulty, JavaFormatStats, JavaFormatTheme } from '../javaFormatPracticeTypes.js'

const validDifficulties: JavaFormatDifficulty[] = ['beginner', 'intermediate', 'advanced']
const validThemes: JavaFormatTheme[] = ['all', 'wanted-poster', 'fantasy-menu', 'spy-badge']

function validateInt(value: unknown, max = 100_000): number {
  const numberValue = Number.parseInt(String(value), 10)
  if (Number.isNaN(numberValue) || numberValue < 0 || numberValue > max) {
    return 0
  }
  return numberValue
}

export function validateStudentName(name: unknown): string | null {
  if (!name || typeof name !== 'string') {
    return null
  }

  const sanitized = name.trim().slice(0, 50)
  if (sanitized.length === 0) {
    return null
  }

  const validPattern = /^[a-zA-Z0-9\s\-'.]+$/
  if (!validPattern.test(sanitized)) {
    return null
  }

  return sanitized
}

export function validateStats(stats: unknown): JavaFormatStats | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return null
  }

  const candidate = stats as Record<string, unknown>
  const sanitized: JavaFormatStats = {
    total: validateInt(candidate.total),
    correct: validateInt(candidate.correct),
    streak: validateInt(candidate.streak, 10_000),
    longestStreak: validateInt(candidate.longestStreak, 10_000),
  }

  if (sanitized.correct > sanitized.total) {
    sanitized.correct = sanitized.total
  }

  if (sanitized.longestStreak < sanitized.streak) {
    sanitized.longestStreak = sanitized.streak
  }

  return sanitized
}

export function validateDifficulty(difficulty: unknown): JavaFormatDifficulty {
  if (validDifficulties.includes(difficulty as JavaFormatDifficulty)) {
    return difficulty as JavaFormatDifficulty
  }
  return 'beginner'
}

export function validateTheme(theme: unknown): JavaFormatTheme {
  if (validThemes.includes(theme as JavaFormatTheme)) {
    return theme as JavaFormatTheme
  }
  return 'all'
}
