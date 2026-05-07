import type { BinaryBreachAnswer, BinaryBreachChallenge, BinaryBreachFeedback } from '../binaryBreachTypes.js'
import { binaryToDecimal, normalizeBinaryAnswer, normalizeDecimalAnswer, orderBinaryValues } from './binaryUtils.js'

function expectedAnswerText(challenge: BinaryBreachChallenge): string {
  if (challenge.type === 'binary-to-decimal') return String(challenge.decimal)
  if (challenge.type === 'decimal-to-binary') return challenge.binary
  if (challenge.type === 'compare-binary') return challenge.answer === 'left' ? challenge.left : challenge.right
  return challenge.answer.join(', ')
}

export function validateBinaryBreachAnswer(
  challenge: BinaryBreachChallenge,
  answer: BinaryBreachAnswer,
): BinaryBreachFeedback {
  let correct = false

  if (challenge.type === 'binary-to-decimal' && answer.type === challenge.type) {
    correct = normalizeDecimalAnswer(answer.decimal) === challenge.decimal
  } else if (challenge.type === 'decimal-to-binary' && answer.type === challenge.type) {
    correct = normalizeBinaryAnswer(answer.binary) === challenge.binary
  } else if (challenge.type === 'compare-binary' && answer.type === challenge.type) {
    correct = answer.choice === challenge.answer
  } else if (challenge.type === 'order-binary' && answer.type === challenge.type) {
    const normalized = answer.values.map((value) => normalizeBinaryAnswer(value)).filter((value): value is string => value != null)
    correct = normalized.length === challenge.answer.length
      && normalized.every((value, index) => value === challenge.answer[index])
  }

  const expectedAnswer = expectedAnswerText(challenge)
  const decimalValue = challenge.type === 'binary-to-decimal'
    ? challenge.decimal
    : challenge.type === 'decimal-to-binary'
      ? challenge.decimal
      : undefined

  return {
    correct,
    expectedAnswer,
    decimalValue,
    message: correct
      ? 'Access granted. System restored.'
      : `Code rejected. Expected ${expectedAnswer}. Check the place values and try the next system.`,
  }
}

export function serializeAnswerFromUnknown(challenge: BinaryBreachChallenge, value: unknown): BinaryBreachAnswer | null {
  const source = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  if (challenge.type === 'binary-to-decimal') {
    return { type: challenge.type, decimal: String(source.decimal ?? '') }
  }
  if (challenge.type === 'decimal-to-binary') {
    return { type: challenge.type, binary: String(source.binary ?? '') }
  }
  if (challenge.type === 'compare-binary') {
    return source.choice === 'left' || source.choice === 'right'
      ? { type: challenge.type, choice: source.choice }
      : null
  }
  if (Array.isArray(source.values)) {
    return {
      type: challenge.type,
      values: source.values.filter((item): item is string => typeof item === 'string'),
    }
  }
  return null
}

export function buildAnswerSummary(challenge: BinaryBreachChallenge): string {
  if (challenge.type === 'compare-binary') {
    const winningBinary = challenge.answer === 'left' ? challenge.left : challenge.right
    const value = binaryToDecimal(winningBinary)
    return `${winningBinary} equals ${value}`
  }
  if (challenge.type === 'order-binary') {
    return orderBinaryValues(challenge.values).join(', ')
  }
  return expectedAnswerText(challenge)
}
