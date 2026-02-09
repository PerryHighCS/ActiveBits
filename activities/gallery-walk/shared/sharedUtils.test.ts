import assert from 'node:assert/strict'
import test from 'node:test'
import { generateShortId } from './id'
import { hashStringFNV1a, normalizeKeyPart, toKeyLabel } from './keyUtils'
import {
    DEFAULT_NOTE_STYLE_ID,
    NOTE_STYLE_OPTIONS,
    getNoteStyleClassName,
    isNoteStyleId,
    normalizeNoteStyleId,
} from './noteStyles'

void test('generateShortId returns uppercase alphanumeric ids of requested length', () => {
  const id = generateShortId(8)
  assert.equal(id.length, 8)
  assert.match(id, /^[BCDFGHJKLMNPQRSTVWXYZ23456789]{8}$/)
})

void test('normalizeNoteStyleId falls back to default style for invalid values', () => {
  assert.equal(normalizeNoteStyleId('invalid-style'), DEFAULT_NOTE_STYLE_ID)
  assert.equal(normalizeNoteStyleId(null), DEFAULT_NOTE_STYLE_ID)

  const validId = NOTE_STYLE_OPTIONS[1]?.id
  assert.equal(normalizeNoteStyleId(validId), validId)
  assert.equal(isNoteStyleId(validId), true)
})

void test('getNoteStyleClassName returns expected class and defaults safely', () => {
  const validId = NOTE_STYLE_OPTIONS[2]?.id
  const validClassName = NOTE_STYLE_OPTIONS[2]?.className
  assert.equal(getNoteStyleClassName(validId), validClassName)
  assert.equal(getNoteStyleClassName('unknown'), getNoteStyleClassName(DEFAULT_NOTE_STYLE_ID))
})

void test('normalizeKeyPart converts values to strings and handles nullish values', () => {
  assert.equal(normalizeKeyPart('test'), 'test')
  assert.equal(normalizeKeyPart(123), '123')
  assert.equal(normalizeKeyPart(null), '')
  assert.equal(normalizeKeyPart(undefined), '')
  assert.equal(normalizeKeyPart(true), 'true')
})

void test('toKeyLabel truncates long values and handles edge cases', () => {
  assert.equal(toKeyLabel('short'), 'short')
  assert.equal(toKeyLabel('a'.repeat(24)), 'a'.repeat(24))
  assert.equal(toKeyLabel('a'.repeat(25)), 'a'.repeat(24) + '~')
  assert.equal(toKeyLabel(''), '-')
  assert.equal(toKeyLabel('   '), '-')
  assert.equal(toKeyLabel(null), '-')
  assert.equal(toKeyLabel(undefined), '-')
})

void test('hashStringFNV1a produces deterministic hashes', () => {
  const input1 = 'test string'
  const input2 = 'test string'
  const input3 = 'different string'
  
  assert.equal(hashStringFNV1a(input1), hashStringFNV1a(input2))
  assert.notEqual(hashStringFNV1a(input1), hashStringFNV1a(input3))
  assert.match(hashStringFNV1a(input1), /^[a-z0-9]+$/)
})
