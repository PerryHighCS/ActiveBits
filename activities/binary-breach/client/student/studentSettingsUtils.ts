import type { BinaryBreachSettings } from '../../binaryBreachTypes.js'
import { normalizeBinaryBreachSettings } from '../../shared/challengeGenerator.js'

export function normalizeStudentMissionSettings(value: unknown): BinaryBreachSettings {
  return normalizeBinaryBreachSettings(value)
}

export function normalizeStudentMissionSettingsFromLaunchOptions(value: unknown): BinaryBreachSettings {
  const source = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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

export function normalizeSoloMissionSettingsFromSearch(search: string): BinaryBreachSettings {
  const params = new URLSearchParams(search)
  return normalizeStudentMissionSettingsFromLaunchOptions({
    maxBits: params.get('maxBits') ?? undefined,
    missionLength: params.get('missionLength') ?? undefined,
    challengeTypes: params.get('challengeTypes') ?? undefined,
    hintsEnabled: params.get('hintsEnabled') ?? undefined,
    placeValueSupport: params.get('placeValueSupport') ?? undefined,
  })
}
