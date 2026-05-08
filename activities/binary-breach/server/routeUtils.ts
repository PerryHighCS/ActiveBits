import type {
  BinaryBreachChallenge,
  BinaryBreachProgress,
  BinaryBreachSettings,
  BinaryBreachStudentRecord,
} from '../binaryBreachTypes.js'
import { normalizeBinaryBreachSettings } from '../shared/challengeGenerator.js'
import { calculateMissionScore, createInitialProgress } from '../shared/scoring.js'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateStudentName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, 50)
  if (trimmed.length === 0) return null
  return /^[a-zA-Z0-9\s\-'.]+$/.test(trimmed) ? trimmed : null
}

export function validateStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, 100)
  if (trimmed.length === 0) return null
  return /^[a-zA-Z0-9._:/-]+$/.test(trimmed) ? trimmed : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null
}

function readEmbeddedLaunchSelectedOptions(data: unknown): Record<string, unknown> | null {
  const source = readRecord(data)
  const embeddedLaunch = readRecord(source?.embeddedLaunch)
  return readRecord(embeddedLaunch?.selectedOptions)
}

export function normalizeBinaryBreachSettingsFromLaunchOptions(value: unknown): BinaryBreachSettings {
  const source = readRecord(value) ?? {}
  return normalizeBinaryBreachSettings({
    maxBits: source.maxBits,
    missionLength: source.missionLength,
    challengeTypes: typeof source.challengeTypes === 'string'
      ? source.challengeTypes.split(',').map((entry) => entry.trim()).filter(Boolean)
      : source.challengeTypes,
    hintsEnabled: source.hintsEnabled === 'false' ? false : source.hintsEnabled,
    placeValueSupport: source.placeValueSupport,
  })
}

export function normalizeBinaryBreachSettingsFromSessionData(data: unknown): BinaryBreachSettings {
  const source = readRecord(data) ?? {}
  if (source.settings !== undefined) {
    return normalizeBinaryBreachSettings(source.settings)
  }

  const selectedOptions = readEmbeddedLaunchSelectedOptions(source)
  if (selectedOptions) {
    return normalizeBinaryBreachSettingsFromLaunchOptions(selectedOptions)
  }

  return normalizeBinaryBreachSettings(source)
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(parsed, max)
}

export function normalizeProgress(value: unknown, settings: BinaryBreachSettings): BinaryBreachProgress {
  if (!isPlainObject(value)) return createInitialProgress()
  const progress: BinaryBreachProgress = {
    systemsRestored: clampInt(value.systemsRestored, 0, settings.missionLength),
    attempts: clampInt(value.attempts, 0, 100000),
    correct: clampInt(value.correct, 0, 100000),
    incorrect: clampInt(value.incorrect, 0, 100000),
    streak: clampInt(value.streak, 0, 100000),
    bestStreak: clampInt(value.bestStreak, 0, 100000),
    hintsUsed: clampInt(value.hintsUsed, 0, 100000),
    traceLevel: clampInt(value.traceLevel, 0, 100000),
    score: 0,
    completed: value.completed === true,
  }
  if (progress.correct > progress.attempts) progress.correct = progress.attempts
  if (progress.incorrect > progress.attempts) progress.incorrect = progress.attempts - progress.correct
  if (progress.bestStreak < progress.streak) progress.bestStreak = progress.streak
  progress.completed = progress.systemsRestored >= settings.missionLength || progress.completed
  progress.score = calculateMissionScore(progress)
  return progress
}

function normalizePersistedChallenge(value: unknown): BinaryBreachChallenge | null {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return null
  }

  const challenge = { ...value } as Record<string, unknown>
  if (typeof challenge.promptEmphasis !== 'string') {
    if (challenge.type === 'binary-to-decimal' && typeof challenge.binary === 'string') {
      challenge.promptEmphasis = `Decode ${challenge.binary}`
    } else if (challenge.type === 'decimal-to-binary' && typeof challenge.decimal === 'number') {
      challenge.promptEmphasis = `binary access code for ${challenge.decimal}`
    } else if (challenge.type === 'compare-binary' && (challenge.target === 'larger' || challenge.target === 'smaller')) {
      challenge.promptEmphasis = `Select the ${challenge.target} signal`
    } else if (challenge.type === 'order-binary') {
      challenge.promptEmphasis = typeof challenge.prompt === 'string' && challenge.prompt.includes('greatest to least')
        ? 'greatest to least'
        : 'least to greatest'
    } else {
      challenge.promptEmphasis = ''
    }
  }

  if (challenge.type === 'order-binary' && challenge.direction !== 'greatest-to-least') {
    challenge.direction = 'least-to-greatest'
  }

  return challenge as unknown as BinaryBreachChallenge
}

export function normalizeBinaryBreachStudent(
  value: unknown,
  settingsInput: unknown,
): BinaryBreachStudentRecord | null {
  if (!isPlainObject(value)) return null
  const settings = normalizeBinaryBreachSettings(settingsInput)
  const name = validateStudentName(value.name)
  const id = validateStudentId(value.id)
  if (!name || !id) return null
  const joined = typeof value.joined === 'number' ? value.joined : Date.now()
  const lastSeen = typeof value.lastSeen === 'number' ? value.lastSeen : joined
  const challengeIndex = clampInt(value.challengeIndex, 0, 100000)
  return {
    id,
    name,
    connected: value.connected === true,
    joined,
    lastSeen,
    progress: normalizeProgress(value.progress, settings),
    currentChallenge: normalizePersistedChallenge(value.currentChallenge),
    challengeIndex,
  }
}
