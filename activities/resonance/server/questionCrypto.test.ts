import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptQuestions, encryptQuestions, MAX_ENCODED_PAYLOAD_CHARS } from './questionCrypto.js'
import type { Question } from '../shared/types.js'

const SAMPLE_QUESTIONS: Question[] = [
  { id: 'q1', type: 'free-response', text: 'What is the capital of France?', order: 0 },
  {
    id: 'q2',
    type: 'multiple-choice',
    text: 'Which is a primary color?',
    order: 1,
    options: [
      { id: 'q2_c', text: 'Red', isCorrect: true },
      { id: 'q2_i1', text: 'Green' },
      { id: 'q2_i2', text: 'Purple' },
    ],
  },
  {
    id: 'q3',
    type: 'multiple-choice',
    text: 'Poll: favorite season?',
    order: 2,
    options: [
      { id: 'q3_a', text: 'Spring' },
      { id: 'q3_b', text: 'Summer' },
      { id: 'q3_c', text: 'Autumn' },
      { id: 'q3_d', text: 'Winter' },
    ],
  },
]

void test('encryptQuestions + decryptQuestions round-trip preserves question data', () => {
  const hash = 'abc123def456'
  const { encoded } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  assert.ok(typeof encoded === 'string' && encoded.length > 0, 'encoded must be a non-empty string')

  const decrypted = decryptQuestions(encoded, hash)
  assert.deepEqual(decrypted, SAMPLE_QUESTIONS, 'decrypted questions must match original')
})

void test('encryptQuestions produces different output on each call (random IV)', () => {
  const hash = 'abc123def456'
  const { encoded: enc1 } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  const { encoded: enc2 } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  assert.notEqual(enc1, enc2, 'each encryption call must produce a unique ciphertext')
})

void test('decryptQuestions returns null when hash (AAD) is wrong (tamper detection)', () => {
  const hash = 'abc123def456'
  const { encoded } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  const result = decryptQuestions(encoded, 'wronghashvalue1')
  assert.equal(result, null, 'decryption must fail when hash does not match')
})

void test('decryptQuestions returns null for malformed input', () => {
  assert.equal(decryptQuestions('not-base64url!!', 'hash'), null)
  assert.equal(decryptQuestions('', 'hash'), null)
  assert.equal(decryptQuestions('YWJj', 'hash'), null, 'too short to be valid')
})

void test('[TEST] decryptQuestions rejects encoded payloads larger than MAX_ENCODED_PAYLOAD_CHARS', () => {
  const oversized = 'a'.repeat(MAX_ENCODED_PAYLOAD_CHARS + 1)
  assert.equal(decryptQuestions(oversized, 'hash'), null)
})

void test('decryptQuestions returns null when ciphertext is bit-flipped (tamper detection)', () => {
  const hash = 'abc123def456'
  const { encoded } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  const buf = Buffer.from(encoded, 'base64url')
  const originalByte = buf.at(28)
  if (originalByte === undefined) {
    throw new Error('encoded payload must be long enough to flip ciphertext bytes')
  }
  // Flip a bit in the ciphertext region (after IV + authTag)
  buf[28] = originalByte ^ 0x01
  const tampered = buf.toString('base64url')
  const result = decryptQuestions(tampered, hash)
  assert.equal(result, null, 'decryption must fail after ciphertext tamper')
})

void test('encoded payload fits within MAX_ENCODED_PAYLOAD_CHARS for a typical question set', () => {
  const hash = 'abc123def456'
  const { sizeChars } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  assert.ok(sizeChars <= MAX_ENCODED_PAYLOAD_CHARS, `payload size ${sizeChars} chars exceeds limit ${MAX_ENCODED_PAYLOAD_CHARS}`)
})

void test('encoded payload contains only URL-safe characters (base64url)', () => {
  const hash = 'abc123def456'
  const { encoded } = encryptQuestions(SAMPLE_QUESTIONS, hash)
  assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded), 'encoded string must be URL-safe base64url')
})

void test('[TEST] large question set that exceeds size limit produces an oversized payload', () => {
  // Build a question set large enough to blow the limit (expected noisy output).
  // Text uses per-question numeric sequences to resist deflate compression — unlike
  // repeated characters, varied base-36 values produce near-incompressible output.
  const bigQuestions: Question[] = Array.from({ length: 100 }, (_, i) => ({
    id: `q${i + 1}`,
    type: 'free-response' as const,
    text: Array.from({ length: 20 }, (__, j) => ((i + 1) * 97 * (j + 1) * 83 + 100003).toString(36)).join(' '),
    order: i,
  }))

  const hash = 'abc123def456'
  const { sizeChars } = encryptQuestions(bigQuestions, hash)
  assert.ok(sizeChars > MAX_ENCODED_PAYLOAD_CHARS, `expected oversized payload (got ${sizeChars}, limit is ${MAX_ENCODED_PAYLOAD_CHARS})`)
})
