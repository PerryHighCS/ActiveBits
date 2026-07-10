import assert from 'node:assert/strict'
import test from 'node:test'
import { SHARED_REACTION_OPTIONS } from '../../shared/reactions.js'
import {
  STUDENT_REACTION_EMOJIS,
  STUDENT_REACTION_EMOJI_VALUES,
  isValidStudentReactionEmoji,
} from './emojiSet.js'

void test('student reaction emojis use canonical shared reaction values', () => {
  assert.deepEqual(
    STUDENT_REACTION_EMOJIS.map((entry) => entry.emoji),
    SHARED_REACTION_OPTIONS.map((entry) => entry.value),
  )
  assert.deepEqual(
    STUDENT_REACTION_EMOJI_VALUES,
    SHARED_REACTION_OPTIONS.map((entry) => entry.value),
  )
  assert.equal(isValidStudentReactionEmoji(SHARED_REACTION_OPTIONS[0]?.value ?? ''), true)
})
