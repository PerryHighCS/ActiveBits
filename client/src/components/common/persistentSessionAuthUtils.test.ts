import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePersistentSessionAuthFailure } from './persistentSessionAuthUtils'

void test('resolvePersistentSessionAuthFailure falls back to the default message for empty payloads', () => {
  assert.deepEqual(resolvePersistentSessionAuthFailure(undefined), {
    message: 'Invalid teacher code',
    isEntryPolicyRejected: false,
    entryPolicy: undefined,
  })
})

void test('resolvePersistentSessionAuthFailure preserves server error messaging', () => {
  assert.deepEqual(
    resolvePersistentSessionAuthFailure({ error: 'Teacher code must be at least 6 characters' }),
    {
      message: 'Teacher code must be at least 6 characters',
      isEntryPolicyRejected: false,
      entryPolicy: undefined,
    },
  )
})

void test('resolvePersistentSessionAuthFailure recognizes solo-only policy rejection payloads', () => {
  assert.deepEqual(
    resolvePersistentSessionAuthFailure({
      error: 'This permanent link is configured for solo use only.',
      code: 'entry-policy-rejected',
      entryPolicy: 'solo-only',
    }),
    {
      message: 'This permanent link is configured for solo use only.',
      isEntryPolicyRejected: true,
      entryPolicy: 'solo-only',
    },
  )
})
