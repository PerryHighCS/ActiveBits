import type { BinaryBreachSettings } from '../../binaryBreachTypes.js'
import { normalizeBinaryBreachSettings } from '../../shared/challengeGenerator.js'

export function normalizeStudentMissionSettings(value: unknown): BinaryBreachSettings {
  return normalizeBinaryBreachSettings(value)
}
