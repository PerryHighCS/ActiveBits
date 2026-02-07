import assert from 'node:assert/strict'
import test from 'node:test'
import type { JavaStringChallenge } from '../../javaStringPracticeTypes.js'
import { generateChallenge, getExplanation, validateAnswer } from './challengeLogic.js'

test('generateChallenge respects selected method filters', () => {
  const challenge = generateChallenge(new Set(['substring']))
  assert.equal(challenge.type, 'substring')
})

test('generateChallenge supports all-mode fallback', () => {
  const challenge = generateChallenge(new Set(['all']))
  assert.ok(['substring', 'indexOf', 'equals', 'length', 'compareTo'].includes(challenge.type))
})

test('validateAnswer normalizes equals/compareTo answers', () => {
  const equalsChallenge: JavaStringChallenge = {
    type: 'equals',
    hint: 'hint',
    text1: 'A',
    text2: 'A',
    var1: 'a',
    var2: 'b',
    callingVar: 'a',
    parameterVar: 'b',
    expectedAnswer: true,
    question: 'q',
  }

  const compareToChallenge: JavaStringChallenge = {
    type: 'compareTo',
    hint: 'hint',
    text1: 'a',
    text2: 'b',
    var1: 'a',
    var2: 'b',
    callingVar: 'a',
    parameterVar: 'b',
    callingText: 'a',
    parameterText: 'b',
    expectedAnswer: 'negative',
    question: 'q',
  }

  assert.equal(validateAnswer(equalsChallenge, 'TRUE'), true)
  assert.equal(validateAnswer(compareToChallenge, ' Negative '), true)
})

test('getExplanation returns challenge-specific guidance', () => {
  const lengthChallenge: JavaStringChallenge = {
    type: 'length',
    hint: 'hint',
    text: 'abc',
    varName: 'text',
    expectedAnswer: 3,
    question: 'q',
  }

  assert.match(getExplanation(lengthChallenge), /contains 3 characters/)
})
