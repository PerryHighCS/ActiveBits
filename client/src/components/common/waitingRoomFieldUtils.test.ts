import test from 'node:test'
import assert from 'node:assert/strict'
import type { ComponentType } from 'react'
import type { WaitingRoomFieldComponentProps } from '../../../../types/waitingRoom.js'
import { getCustomFieldStatus } from './waitingRoomFieldUtils'

function DummyCustomField(): null {
  return null
}

void test('getCustomFieldStatus reports loading state while a custom field registry is unresolved', () => {
  assert.equal(
    getCustomFieldStatus(
      { id: 'chooser', type: 'custom', component: 'ChooserField', label: 'Chooser' },
      null,
      null,
    ),
    'Loading custom field for Chooser...',
  )
})

void test('getCustomFieldStatus reports load failure when custom field registry fails', () => {
  assert.equal(
    getCustomFieldStatus(
      { id: 'chooser', type: 'custom', component: 'ChooserField', label: 'Chooser' },
      null,
      'Custom waiting-room fields are unavailable right now.',
    ),
    'Custom waiting-room fields are unavailable right now. Chooser cannot be rendered.',
  )
})

void test('getCustomFieldStatus returns empty copy when the custom field component is available', () => {
  assert.equal(
    getCustomFieldStatus(
      { id: 'chooser', type: 'custom', component: 'ChooserField', label: 'Chooser' },
      DummyCustomField as ComponentType<WaitingRoomFieldComponentProps>,
      null,
    ),
    '',
  )
})
