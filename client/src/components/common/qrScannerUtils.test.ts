import test from 'node:test'
import assert from 'node:assert/strict'
import { getQrScannerErrorCode, getQrScannerErrorMessage } from './qrScannerUtils'

void test('getQrScannerErrorCode maps known scanner errors', () => {
  assert.equal(getQrScannerErrorCode({ name: 'NotAllowedError' }), 'camera-error')
  assert.equal(getQrScannerErrorCode({ name: 'NotFoundException' }), 'scanner-error')
  assert.equal(getQrScannerErrorCode({ name: 'AbortError' }), 'scanner-unavailable')
  assert.equal(getQrScannerErrorCode(null), 'scanner-unavailable')
})

void test('getQrScannerErrorMessage returns user-facing copy', () => {
  assert.match(getQrScannerErrorMessage('camera-error'), /Unable to access the camera/)
  assert.match(getQrScannerErrorMessage('scanner-error'), /Scanning failed/)
  assert.match(getQrScannerErrorMessage('scanner-unavailable'), /not supported/)
  assert.match(getQrScannerErrorMessage(undefined), /not supported/)
})
