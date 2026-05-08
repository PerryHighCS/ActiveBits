import type {
  BinaryBreachChallenge,
  BinaryBreachChallengeType,
  BinaryBreachSettings,
} from '../binaryBreachTypes.js'
import { decimalToBinary, maxUnsignedValueForBits, orderBinaryValues } from './binaryUtils.js'

export const BINARY_BREACH_CHALLENGE_TYPES: BinaryBreachChallengeType[] = [
  'binary-to-decimal',
  'decimal-to-binary',
  'compare-binary',
  'order-binary',
]

export const DEFAULT_BINARY_BREACH_SETTINGS: BinaryBreachSettings = {
  maxBits: 8,
  challengeTypes: [...BINARY_BREACH_CHALLENGE_TYPES],
  missionLength: 5,
  timerMode: 'off',
  hintsEnabled: true,
  placeValueSupport: 'visible',
}

const SYSTEM_NAMES = [
  'Door Lock',
  'Signal Router',
  'Sorting Core',
  'Memory Bank',
  'Repair Console',
  'Firewall Rule',
  'Backup Generator',
  'Drone Recovery',
]

const SYSTEM_TRANSMISSIONS: Record<string, string> = {
  'Door Lock': 'Security door motors are ignoring badge traffic. Restore the access code before the lab shifts into manual lockdown.',
  'Signal Router': 'The campus router is dropping packets from the robotics lab. Verify the strongest signal path and reopen the route.',
  'Sorting Core': 'A scrambled priority queue is delaying every recovery job. Put the packets back in order so repairs can resume.',
  'Memory Bank': 'The memory vault is rejecting address reads after a rogue bit sweep. Decode the value and rebuild the access table.',
  'Repair Console': 'The maintenance console is waiting on a clean override. Send the corrected value so the control panel can reboot.',
  'Firewall Rule': 'The firewall is quarantining safe classroom traffic. Confirm the rule value and release the blocked channel.',
  'Backup Generator': 'The backup generator is online but its controller has lost calibration. Translate the packet before power is rerouted.',
  'Drone Recovery': 'A training drone is hovering in safe mode with a scrambled nav token. Recover the code and guide it home.',
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return ((state >>> 0) / 4294967296)
  }
}

function pick<T>(items: T[], random: () => number): T {
  const first = items[0]
  if (first == null) {
    throw new Error('Cannot pick from an empty list')
  }
  return items[Math.floor(random() * items.length)] ?? first
}

function integerBetween(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1))
}

function shuffleValues<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    const swap = shuffled[swapIndex]
    if (current === undefined || swap === undefined) continue
    shuffled[index] = swap
    shuffled[swapIndex] = current
  }
  return shuffled
}

function normalizeMaxBits(bits: number): 4 | 5 | 6 | 7 | 8 {
  if (bits <= 4) return 4
  if (bits >= 8) return 8
  return bits as 4 | 5 | 6 | 7 | 8
}

export function sanitizeChallengeTypes(value: unknown): BinaryBreachChallengeType[] {
  if (!Array.isArray(value)) return [...BINARY_BREACH_CHALLENGE_TYPES]
  const types = value.filter((type): type is BinaryBreachChallengeType =>
    typeof type === 'string'
      && (BINARY_BREACH_CHALLENGE_TYPES as string[]).includes(type),
  )
  return types.length > 0 ? Array.from(new Set(types)) : [...BINARY_BREACH_CHALLENGE_TYPES]
}

export function normalizeBinaryBreachSettings(value: unknown): BinaryBreachSettings {
  const source = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const maxBitsValue = Number.parseInt(String(source.maxBits ?? DEFAULT_BINARY_BREACH_SETTINGS.maxBits), 10)
  const missionLengthValue = Number.parseInt(String(source.missionLength ?? DEFAULT_BINARY_BREACH_SETTINGS.missionLength), 10)
  const timerMode = source.timerMode === 'generous' || source.timerMode === 'standard' ? source.timerMode : 'off'
  const placeValueSupport = source.placeValueSupport === 'optional' || source.placeValueSupport === 'hidden'
    ? source.placeValueSupport
    : 'visible'

  return {
    maxBits: normalizeMaxBits(Number.isFinite(maxBitsValue) ? maxBitsValue : DEFAULT_BINARY_BREACH_SETTINGS.maxBits),
    challengeTypes: sanitizeChallengeTypes(source.challengeTypes),
    missionLength: Math.max(3, Math.min(
      12,
      Number.isFinite(missionLengthValue) ? missionLengthValue : DEFAULT_BINARY_BREACH_SETTINGS.missionLength,
    )),
    timerMode,
    hintsEnabled: source.hintsEnabled !== false,
    placeValueSupport,
  }
}

export function createMissionSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createBinaryBreachChallenge(
  settings: BinaryBreachSettings,
  seed: string,
  challengeIndex: number,
): BinaryBreachChallenge {
  const random = createSeededRandom(`${seed}:${challengeIndex}`)
  const type = pick(settings.challengeTypes, random)
  const max = maxUnsignedValueForBits(settings.maxBits)
  const systemName = SYSTEM_NAMES[challengeIndex % SYSTEM_NAMES.length] ?? 'Locked System'
  const transmission = SYSTEM_TRANSMISSIONS[systemName]
    ?? 'A locked classroom system is waiting for a verified binary override. Solve the packet and restore control.'
  const id = `${seed}:${challengeIndex}:${type}`
  const maxBits = settings.maxBits

  if (type === 'binary-to-decimal') {
    const decimal = integerBetween(1, max, random)
    const binary = decimalToBinary(decimal)
    return {
      id,
      type,
      systemName,
      prompt: `${transmission} Decode ${binary} to restore ${systemName}.`,
      promptEmphasis: `Decode ${binary}`,
      maxBits,
      hintLevel: 0,
      binary,
      decimal,
    }
  }

  if (type === 'decimal-to-binary') {
    const decimal = integerBetween(1, max, random)
    const binary = decimalToBinary(decimal)
    return {
      id,
      type,
      systemName,
      prompt: `${transmission} Upload the binary access code for ${decimal}.`,
      promptEmphasis: `binary access code for ${decimal}`,
      maxBits,
      hintLevel: 0,
      decimal,
      binary,
    }
  }

  if (type === 'compare-binary') {
    const leftValue = integerBetween(1, max, random)
    let rightValue = integerBetween(1, max, random)
    if (leftValue === rightValue) {
      rightValue = rightValue === max ? rightValue - 1 : rightValue + 1
    }
    const target = random() > 0.5 ? 'larger' : 'smaller'
    const answer = target === 'larger'
      ? leftValue > rightValue ? 'left' : 'right'
      : leftValue < rightValue ? 'left' : 'right'
    return {
      id,
      type,
      systemName,
      prompt: `${transmission} Select the ${target} signal to verify ${systemName}.`,
      promptEmphasis: `Select the ${target} signal`,
      maxBits,
      hintLevel: 0,
      left: decimalToBinary(leftValue),
      right: decimalToBinary(rightValue),
      target,
      answer,
    }
  }

  const values = new Set<string>()
  while (values.size < 4) {
    values.add(decimalToBinary(integerBetween(1, max, random)))
  }
  const shuffled = shuffleValues(Array.from(values), random)
  const direction = random() > 0.5 ? 'least-to-greatest' : 'greatest-to-least'
  const ascendingAnswer = orderBinaryValues(shuffled)
  const answer = direction === 'least-to-greatest' ? ascendingAnswer : [...ascendingAnswer].reverse()
  const directionText = direction === 'least-to-greatest' ? 'least to greatest' : 'greatest to least'
  return {
    id,
    type: 'order-binary',
    systemName,
    prompt: `${transmission} Arrange the recovery queue from ${directionText} for ${systemName}.`,
    promptEmphasis: directionText,
    maxBits,
    hintLevel: 0,
    values: shuffled,
    direction,
    answer,
  }
}

export function getHintForChallenge(challenge: BinaryBreachChallenge): string {
  if (challenge.type === 'binary-to-decimal') {
    return `Use the chart as a map: add the place values under 1 bits and ignore every column with a 0.`
  }
  if (challenge.type === 'decimal-to-binary') {
    return `Start with the largest power of two that fits inside ${challenge.decimal}, then subtract what you used.`
  }
  if (challenge.type === 'compare-binary') {
    return 'A longer binary number is usually larger. If lengths match, compare from the leftmost bit.'
  }
  return 'Shorter binary numbers often come first. When lengths match, compare from left to right.'
}
