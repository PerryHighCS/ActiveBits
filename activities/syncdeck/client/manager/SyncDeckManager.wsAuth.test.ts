import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckInstructorWsUrl,
  createSyncDeckInstructorWsAuthMessage,
} from './SyncDeckManager.js'

void test('buildSyncDeckInstructorWsUrl omits instructor credentials from websocket URL', () => {
  assert.equal(
    buildSyncDeckInstructorWsUrl({
      sessionId: 'session-123',
      location: {
        protocol: 'https:',
        host: 'bits.example.test',
      },
      isConfigurePanelOpen: false,
    }),
    'wss://bits.example.test/ws/syncdeck?sessionId=session-123&role=instructor',
  )
})

void test('buildSyncDeckInstructorWsUrl returns null when configure panel is open or session missing', () => {
  assert.equal(
    buildSyncDeckInstructorWsUrl({
      sessionId: 'session-123',
      location: {
        protocol: 'https:',
        host: 'bits.example.test',
      },
      isConfigurePanelOpen: true,
    }),
    null,
  )
  assert.equal(
    buildSyncDeckInstructorWsUrl({
      sessionId: null,
      location: {
        protocol: 'https:',
        host: 'bits.example.test',
      },
      isConfigurePanelOpen: false,
    }),
    null,
  )
})

void test('createSyncDeckInstructorWsAuthMessage serializes post-connect auth payload', () => {
  assert.equal(
    createSyncDeckInstructorWsAuthMessage('teacher-passcode'),
    JSON.stringify({
      type: 'authenticate',
      instructorPasscode: 'teacher-passcode',
    }),
  )
  assert.equal(createSyncDeckInstructorWsAuthMessage(''), null)
  assert.equal(createSyncDeckInstructorWsAuthMessage(null), null)
})
