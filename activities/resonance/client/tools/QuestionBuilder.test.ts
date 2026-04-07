import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_MCQ_OPTIONS, newOptionId, newQuestionId } from './QuestionBuilder.js'

void test('QuestionBuilder allows up to 10 multiple-choice options', () => {
  assert.equal(MAX_MCQ_OPTIONS, 10)
})

void test('newOptionId prefers crypto.randomUUID when available', () => {
  const previousCrypto = globalThis.crypto
  const randomUUID = () => '123e4567-e89b-12d3-a456-426614174000'

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID },
  })

  try {
    assert.equal(newOptionId(), 'opt_123e4567-e89b-12d3-a456-426614174000')
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: previousCrypto,
    })
  }
})

void test('newOptionId falls back to a prefixed timestamp-random id when crypto.randomUUID is unavailable', () => {
  const previousCrypto = globalThis.crypto
  const previousDateNow = Date.now
  const previousRandom = Math.random

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  })
  Date.now = () => 1_700_000_000_000
  Math.random = () => 0.123456789

  try {
    assert.equal(newOptionId(), 'opt_loyw3v28_4fzzzxjy')
  } finally {
    Date.now = previousDateNow
    Math.random = previousRandom
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: previousCrypto,
    })
  }
})

void test('newQuestionId prefers crypto.randomUUID when available', () => {
  const previousCrypto = globalThis.crypto
  const randomUUID = () => '123e4567-e89b-12d3-a456-426614174111'

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID },
  })

  try {
    assert.equal(newQuestionId(), 'q_123e4567-e89b-12d3-a456-426614174111')
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: previousCrypto,
    })
  }
})

void test('newQuestionId falls back to a prefixed timestamp-random id when crypto.randomUUID is unavailable', () => {
  const previousCrypto = globalThis.crypto
  const previousDateNow = Date.now
  const previousRandom = Math.random

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  })
  Date.now = () => 1_700_000_000_000
  Math.random = () => 0.123456789

  try {
    assert.equal(newQuestionId(), 'q_loyw3v28_4fzzzxjy')
  } finally {
    Date.now = previousDateNow
    Math.random = previousRandom
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: previousCrypto,
    })
  }
})
