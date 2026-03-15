import assert from 'node:assert/strict'
import test from 'node:test'
import type { PersistentSessionEntryStatus } from '../types/waitingRoom.js'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import {
  cleanupPersistentSession,
  generatePersistentHash,
  initializePersistentStorage,
} from './core/persistentSessions.js'
import { loadPersistentSessionEntryGatewayContext } from './core/persistentSessionEntryGateway.js'

void test('loadPersistentSessionEntryGatewayContext normalizes entryPolicyOverride before returning context', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'gateway-normalize-code')
  t.after(async () => cleanupPersistentSession(hash))

  const context = await loadPersistentSessionEntryGatewayContext({
    activityName,
    hash,
    hasTeacherCookie: false,
    entryPolicyOverride: 'not-a-valid-policy' as unknown as PersistentSessionEntryStatus['entryPolicy'],
    sessions: {
      get: async () => null,
    },
  })

  assert.equal(context.entryPolicy, 'instructor-required')
})
