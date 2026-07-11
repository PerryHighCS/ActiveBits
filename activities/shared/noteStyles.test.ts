import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_NOTE_STYLE_ID,
  NOTE_STYLE_OPTIONS,
  getNoteStyleClassName,
  isNoteStyleId,
  normalizeNoteStyleId,
} from './noteStyles.js'

void test('shared note styles normalize ids and class names', () => {
  assert.equal(DEFAULT_NOTE_STYLE_ID, 'lemon')
  assert.equal(NOTE_STYLE_OPTIONS.length, 10)
  assert.equal(isNoteStyleId('grid'), true)
  assert.equal(isNoteStyleId('unknown'), false)
  assert.equal(isNoteStyleId('toString'), false)
  assert.equal(isNoteStyleId('__proto__'), false)
  assert.equal(normalizeNoteStyleId('vertical'), 'vertical')
  assert.equal(normalizeNoteStyleId('unknown'), DEFAULT_NOTE_STYLE_ID)
  assert.equal(normalizeNoteStyleId('toString'), DEFAULT_NOTE_STYLE_ID)
  assert.equal(getNoteStyleClassName('diagonal'), 'note-style-diagonal')
  assert.equal(getNoteStyleClassName('unknown'), 'note-style-lemon')
})
