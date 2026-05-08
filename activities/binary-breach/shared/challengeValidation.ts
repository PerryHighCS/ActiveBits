import type { BinaryBreachAnswer, BinaryBreachChallenge, BinaryBreachFeedback } from '../binaryBreachTypes.js'
import { binaryToDecimal, normalizeBinaryAnswer, normalizeDecimalAnswer, orderBinaryValues } from './binaryUtils.js'

function expectedAnswerText(challenge: BinaryBreachChallenge): string {
  if (challenge.type === 'binary-to-decimal') return String(challenge.decimal)
  if (challenge.type === 'decimal-to-binary') return challenge.binary
  if (challenge.type === 'compare-binary') return challenge.answer === 'left' ? challenge.left : challenge.right
  return challenge.answer.join(', ')
}

function formatBinaryValue(binary: string): string {
  const decimal = binaryToDecimal(binary)
  return decimal == null ? `${binary}` : `${binary} (${decimal})`
}

function activePlaceValueText(binary: string): string {
  const bits = binary.split('')
  const values = bits
    .map((bit, index) => bit === '1' ? 2 ** (bits.length - index - 1) : null)
    .filter((value): value is number => value != null)
  return values.length > 0 ? values.join(' + ') : '0'
}

function incorrectFeedbackMessage(challenge: BinaryBreachChallenge, answer: BinaryBreachAnswer): string {
  if (challenge.type === 'binary-to-decimal' && answer.type === challenge.type) {
    const submitted = normalizeDecimalAnswer(answer.decimal)
    const submittedText = submitted == null ? 'that entry' : String(submitted)
    const direction = submitted == null
      ? 'Check that the access code uses only digits.'
      : submitted < challenge.decimal
        ? 'Your answer is too low.'
        : 'Your answer is too high.'
    return `Code rejected. You entered ${submittedText}. ${direction} Add only the place values under 1 bits: ${activePlaceValueText(challenge.binary)}.`
  }

  if (challenge.type === 'decimal-to-binary' && answer.type === challenge.type) {
    const submitted = normalizeBinaryAnswer(answer.binary)
    const submittedText = submitted == null ? 'an invalid binary code' : submitted
    return `Upload rejected. You sent ${submittedText}, but ${challenge.decimal} needs ${challenge.binary}. Start with the largest fitting power of two and mark each used bit with 1.`
  }

  if (challenge.type === 'compare-binary' && answer.type === challenge.type) {
    const chosen = answer.choice === 'left' ? challenge.left : challenge.right
    const expected = challenge.answer === 'left' ? challenge.left : challenge.right
    const targetLabel = challenge.target === 'larger' ? 'stronger' : 'lower'
    return `Signal mismatch. You chose ${formatBinaryValue(chosen)}, but the ${targetLabel} signal is ${formatBinaryValue(expected)}. Compare bit length first, then scan left to right.`
  }

  if (challenge.type === 'order-binary' && answer.type === challenge.type) {
    const submitted = answer.values.length > 0 ? answer.values.join(', ') : 'no queue'
    const directionText = challenge.direction === 'greatest-to-least' ? 'greatest-to-least' : 'least-to-greatest'
    const guidance = challenge.direction === 'greatest-to-least'
      ? 'Larger decimal values come first; matching lengths compare left to right.'
      : 'Shorter values usually come first; matching lengths compare left to right.'
    return `Queue rejected. You submitted ${submitted}. Correct ${directionText} order is ${challenge.answer.join(', ')}. ${guidance}`
  }

  return `Code rejected. Expected ${expectedAnswerText(challenge)}. Check the place values and try the next system.`
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
      : incorrectFeedbackMessage(challenge, answer),
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
    const ordered = orderBinaryValues(challenge.values)
    return (challenge.direction === 'greatest-to-least' ? ordered.reverse() : ordered).join(', ')
  }
  return expectedAnswerText(challenge)
}
