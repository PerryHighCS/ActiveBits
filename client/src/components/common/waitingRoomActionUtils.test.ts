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
