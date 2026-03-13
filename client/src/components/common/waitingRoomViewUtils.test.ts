import test from 'node:test'
import assert from 'node:assert/strict'
import { getWaitingRoomViewModel } from './waitingRoomViewUtils'

void test('getWaitingRoomViewModel returns wait-state copy and teacher controls by default', () => {
  const viewModel = getWaitingRoomViewModel('wait')

  assert.equal(viewModel.showWaiterCount, true)
  assert.equal(viewModel.showTeacherSection, true)
  assert.equal(viewModel.soloActionLabel, null)
  assert.match(viewModel.statusTitle, /Waiting for teacher/i)
  assert.match(viewModel.fieldHeading, /Before you join/i)
})

void test('getWaitingRoomViewModel returns solo-preflight copy for continue-solo outcome', () => {
  const viewModel = getWaitingRoomViewModel('continue-solo')

  assert.equal(viewModel.showWaiterCount, false)
  assert.equal(viewModel.showTeacherSection, true)
  assert.equal(viewModel.soloActionLabel, 'Continue in Solo Mode')
  assert.match(viewModel.statusTitle, /Solo mode is available/i)
  assert.match(viewModel.fieldHeading, /Before you begin/i)
})
