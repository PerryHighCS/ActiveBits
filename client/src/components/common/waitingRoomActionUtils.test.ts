import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTouchedWaitingRoomFields, resolveWaitingRoomPrimaryAction } from './waitingRoomActionUtils'
import type { WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'

const waitingRoomFields: WaitingRoomFieldConfig[] = [
  {
    id: 'displayName',
    type: 'text',
    label: 'Display name',
    required: true,
  },
  {
    id: 'team',
    type: 'select',
    label: 'Team',
    required: true,
    options: [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ],
  },
]

void test('buildTouchedWaitingRoomFields marks every configured field as touched', () => {
  assert.deepEqual(buildTouchedWaitingRoomFields(waitingRoomFields), {
    displayName: true,
    team: true,
  })
})

void test('resolveWaitingRoomPrimaryAction blocks join-live when required fields are incomplete', () => {
  assert.deepEqual(
    resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors: {
        displayName: 'Display name is required.',
      },
      entryOutcome: 'join-live',
      startedSessionId: 'session-1',
    }),
    {
      touchedFields: {
        displayName: true,
        team: true,
      },
      errorMessage: 'Please complete the required details before joining.',
    },
  )
})

void test('resolveWaitingRoomPrimaryAction blocks solo continuation when required fields are incomplete', () => {
  assert.deepEqual(
    resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors: {
        team: 'Team is required.',
      },
      entryOutcome: 'continue-solo',
    }),
    {
      touchedFields: {
        displayName: true,
        team: true,
      },
      errorMessage: 'Please complete the required details before continuing.',
    },
  )
})

void test('resolveWaitingRoomPrimaryAction blocks join-live when the started session is missing', () => {
  assert.deepEqual(
    resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors: {},
      entryOutcome: 'join-live',
    }),
    {
      touchedFields: {
        displayName: true,
        team: true,
      },
      errorMessage: 'Live session is unavailable right now. Please refresh and try again.',
    },
  )
})

void test('resolveWaitingRoomPrimaryAction allows join-live when fields are valid and a session exists', () => {
  assert.deepEqual(
    resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors: {},
      entryOutcome: 'join-live',
      startedSessionId: 'session-2',
    }),
    {
      touchedFields: {
        displayName: true,
        team: true,
      },
      errorMessage: null,
    },
  )
})

void test('resolveWaitingRoomPrimaryAction blocks entry when outcome is solo-unavailable', () => {
  assert.deepEqual(
    resolveWaitingRoomPrimaryAction({
      waitingRoomFields,
      waitingRoomErrors: {},
      entryOutcome: 'solo-unavailable',
    }),
    {
      touchedFields: {
        displayName: true,
        team: true,
      },
      errorMessage: 'Solo mode is not available for this activity.',
    },
  )
})

void test('resolveWaitingRoomPrimaryAction blocks solo-unavailable even when field errors are present', () => {
  // solo-unavailable is checked after field errors; field errors take priority
  const result = resolveWaitingRoomPrimaryAction({
    waitingRoomFields,
    waitingRoomErrors: { displayName: 'Display name is required.' },
    entryOutcome: 'solo-unavailable',
  })
  assert.equal(typeof result.errorMessage, 'string')
  assert.notEqual(result.errorMessage, null)
})
