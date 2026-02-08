import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateFormatString } from './utils/formatUtils'

interface ChallengeVariable {
  name: string
  type: 'String' | 'int' | 'double'
  value: string
}

interface FormatCallExpectation {
  expectedOutput: string
}

interface IntermediateChallenge {
  variables: ChallengeVariable[]
  formatCalls: FormatCallExpectation[]
}

interface LineValidationResult {
  line: number
  pass: boolean
  expected?: string
  actual?: string
}

function parseLiteralValue(variable: ChallengeVariable): string | number {
  if (variable.type === 'String') {
    return variable.value.replace(/^"(.*)"$/, '$1')
  }
  return Number.parseFloat(variable.value) || 0
}

function validateIntermediate(userAnswer: string, challenge: IntermediateChallenge): LineValidationResult[] {
  const formatMatch =
    userAnswer.match(/"([^"]*)"/) ??
    userAnswer.match(/'([^']*)'/) ??
    userAnswer.match(/(\S+)/)

  const formatString = formatMatch?.[1] ?? ''
  const fullMatch = formatMatch?.[0] ?? ''
  const afterFormat = userAnswer.slice(userAnswer.indexOf(fullMatch) + fullMatch.length).trim()
  const varNames = afterFormat
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  const varValues = varNames.map((name) => {
    const variable = challenge.variables.find((candidate) => candidate.name === name)
    if (!variable) return ''
    return parseLiteralValue(variable)
  })

  return challenge.formatCalls.map((call, index) => {
    const actualOutput = evaluateFormatString(formatString, varValues)
    const expectedOutput = call.expectedOutput
    return {
      line: index + 1,
      pass: actualOutput === expectedOutput,
      expected: expectedOutput,
      actual: actualOutput,
    }
  })
}

const hackerChallenge: IntermediateChallenge = {
  variables: [
    { name: 'user', type: 'String', value: '"admin"' },
    { name: 'attempts', type: 'int', value: '3' },
    { name: 'accessLevel', type: 'int', value: '9' },
    { name: 'timestamp', type: 'double', value: '1621.847' },
  ],
  formatCalls: [
    { expectedOutput: 'admin           | Attempting access\n' },
    { expectedOutput: 'Failed:  3 | Level:  9\n' },
    { expectedOutput: 'Timestamp: 1621.85 seconds\n' },
  ],
}

test('intermediate-style answers evaluate to expected output', () => {
  const answers = [
    '"%-15s | Attempting access%n", user',
    '"Failed: %2d | Level: %2d%n", attempts, accessLevel',
    '"Timestamp: %.2f seconds%n", timestamp',
  ]

  for (const [index, answer] of answers.entries()) {
    const lineOnlyChallenge: IntermediateChallenge = {
      variables: hackerChallenge.variables,
      formatCalls: [hackerChallenge.formatCalls[index] as FormatCallExpectation],
    }
    const [result] = validateIntermediate(answer, lineOnlyChallenge)
    assert.ok(result?.pass, `line ${index + 1} should pass`)
  }
})

test('intermediate-style validation detects width mismatch', () => {
  const [result] = validateIntermediate('%-10s | Attempting access%n", user', hackerChallenge)
  assert.ok(result)
  assert.equal(result.pass, false)
  assert.notEqual(result.expected, result.actual)
})
