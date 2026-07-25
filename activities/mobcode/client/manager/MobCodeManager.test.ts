import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMobCodeManagerSessionSnapshot } from './MobCodeManager'

void test('parseMobCodeManagerSessionSnapshot normalizes valid manager workspaces and filters malformed entries', () => {
  const snapshot = parseMobCodeManagerSessionSnapshot({
    data: {
      groups: { default: { files: { 'Main.java': 'class Main {}' }, activeFile: 'Main.java' } },
      runnerId: 'brython-terminal',
      studentCode: {
        tryItEnabled: true,
        shareChangesEnabled: true,
        starterVersion: { files: { 'Starter.java': 'class Starter {}' }, activeFile: 'Starter.java' },
        students: [
          { participantId: 'ada', displayName: 'Ada', files: { 'Ada.java': 'class Ada {}' }, activeFile: 'Ada.java' },
          { participantId: 'invalid', displayName: 42, files: {}, activeFile: '' },
        ],
        sharedExample: { sourceParticipantId: 'ada', workspace: { files: { 'Shared.java': 'class Shared {}' }, activeFile: 'Shared.java' } },
      },
    },
  })

  assert.deepEqual(snapshot, {
    instructorWorkspace: { files: { 'Main.java': 'class Main {}' }, activeFile: 'Main.java' },
    runnerId: 'brython-terminal',
    tryItEnabled: true,
    shareChangesEnabled: true,
    starterVersion: { files: { 'Starter.java': 'class Starter {}' }, activeFile: 'Starter.java' },
    students: [{ participantId: 'ada', displayName: 'Ada', files: { 'Ada.java': 'class Ada {}' }, activeFile: 'Ada.java' }],
    sharedExample: { sourceParticipantId: 'ada', workspace: { files: { 'Shared.java': 'class Shared {}' }, activeFile: 'Shared.java' } },
  })
})

void test('parseMobCodeManagerSessionSnapshot rejects missing instructor workspaces and partial shared examples', () => {
  assert.equal(parseMobCodeManagerSessionSnapshot({ data: { groups: {} } }), null)

  const snapshot = parseMobCodeManagerSessionSnapshot({
    data: {
      groups: { default: { files: {}, activeFile: '' } },
      studentCode: { sharedExample: { sourceParticipantId: 'ada' } },
    },
  })

  assert.equal(snapshot?.runnerId, null)
  assert.equal(snapshot?.tryItEnabled, false)
  assert.equal(snapshot?.shareChangesEnabled, false)
  assert.equal(snapshot?.sharedExample, null)
})
