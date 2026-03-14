import test from 'node:test'
import assert from 'node:assert/strict'
import { getWaitingRoomViewModel } from './waitingRoomViewUtils'

void test('getWaitingRoomViewModel returns wait-state copy and teacher controls by default', () => {
  const viewModel = getWaitingRoomViewModel('wait')

  assert.equal(viewModel.showWaiterCount, true)
  assert.equal(viewModel.showTeacherSection, true)
  assert.equal(viewModel.primaryActionLabel, null)
  assert.match(viewModel.statusTitle, /Waiting for teacher/i)
  assert.match(viewModel.fieldHeading, /Before you join/i)
})

void test('getWaitingRoomViewModel returns solo-preflight copy for continue-solo outcome', () => {
  const viewModel = getWaitingRoomViewModel('continue-solo')

  assert.equal(viewModel.showWaiterCount, false)
  assert.equal(viewModel.showTeacherSection, true)
  assert.equal(viewModel.primaryActionLabel, 'Continue in Solo Mode')
  assert.match(viewModel.statusTitle, /Solo mode is available/i)
  assert.equal(viewModel.statusDetail, '')
  assert.equal(viewModel.fieldHeading, '')
  assert.equal(viewModel.fieldDescription, '')
})

void test('getWaitingRoomViewModel returns live-join preflight copy for join-live outcome', () => {
  const viewModel = getWaitingRoomViewModel('join-live')

  assert.equal(viewModel.showWaiterCount, false)
  assert.equal(viewModel.showTeacherSection, true)
  assert.equal(viewModel.primaryActionLabel, 'Join Session')
  assert.match(viewModel.statusTitle, /ready to join/i)
  assert.equal(viewModel.statusDetail, '')
  assert.equal(viewModel.fieldHeading, '')
  assert.equal(viewModel.fieldDescription, '')
})
