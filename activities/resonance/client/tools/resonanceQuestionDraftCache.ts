import type { Question } from '../../shared/types.js'
import { validateQuestionSet } from '../../shared/validation.js'

const RESONANCE_QUESTION_DRAFT_STORAGE_PREFIX = 'resonance-question-draft:'

function resolveStorage(): Storage | null {
  if (typeof window === 'undefined' || window.localStorage == null) {
    return null
  }

  return window.localStorage
}

function buildStorageKey(hash: string): string {
  return `${RESONANCE_QUESTION_DRAFT_STORAGE_PREFIX}${hash.trim()}`
}

export function loadResonanceQuestionDraft(hash: string): Question[] | null {
  const normalizedHash = hash.trim()
  if (normalizedHash.length === 0) {
    return null
  }

  const storage = resolveStorage()
  if (storage == null) {
    return null
  }

  const storageKey = buildStorageKey(normalizedHash)
  const raw = storage.getItem(storageKey)
  if (raw == null || raw.length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    const { questions, errors } = validateQuestionSet(parsed)
    if (errors.length > 0 || questions.length === 0) {
      storage.removeItem(storageKey)
      return null
    }

    return questions
  } catch {
    storage.removeItem(storageKey)
    return null
  }
}

export function cacheResonanceQuestionDraft(hash: string, questions: Question[]): void {
  const normalizedHash = hash.trim()
  if (normalizedHash.length === 0 || questions.length === 0) {
    return
  }

  const storage = resolveStorage()
  if (storage == null) {
    return
  }

  const { questions: normalizedQuestions, errors } = validateQuestionSet(questions)
  if (errors.length > 0 || normalizedQuestions.length === 0) {
    return
  }

  try {
    storage.setItem(buildStorageKey(normalizedHash), JSON.stringify(normalizedQuestions))
  } catch {
    // Best-effort cache only; link generation should still succeed.
  }
}
