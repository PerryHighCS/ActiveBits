import test from 'node:test'
import assert from 'node:assert/strict'
import { generateShortId } from './id'
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
