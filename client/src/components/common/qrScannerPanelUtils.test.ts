import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQrScannerOptions, getQrScannerDetectedText } from './qrScannerPanelUtils'

const constraints: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
  },
}

void test('getQrScannerDetectedText returns rawValue only when present', () => {
  assert.equal(getQrScannerDetectedText({ rawValue: 'https://bits.example/session' }), 'https://bits.example/session')
  assert.equal(getQrScannerDetectedText({ rawValue: '' }), null)
  assert.equal(getQrScannerDetectedText({}), null)
})

void test('buildQrScannerOptions wires wasmUrl, constraints, and rawValue detection', () => {
  const detectedTexts: string[] = []
  const detectedStates: boolean[] = []
  const errorCodes: string[] = []
  const options = buildQrScannerOptions({
    constraints,
    hasDetected: false,
    onDetected: (text) => detectedTexts.push(text),
    setErrorCode: (code) => errorCodes.push(code),
    setHasDetected: (hasDetected) => detectedStates.push(hasDetected),
    wasmUrl: '/assets/zxing_reader.wasm',
  })

  assert.equal(options.paused, false)
  assert.equal(options.constraints, constraints)
  assert.equal(options.wasmUrl, '/assets/zxing_reader.wasm')

  options.onDecodeResult({ rawValue: 'https://bits.example/gallery?reviewee=a' })
  options.onError({ name: 'NotAllowedError' })
  options.onDecodeResult({ rawValue: 'https://bits.example/gallery?reviewee=b' })
  options.onDecodeResult({ rawValue: '' })

  assert.deepEqual(detectedStates, [true])
  assert.deepEqual(detectedTexts, ['https://bits.example/gallery?reviewee=a'])
  assert.deepEqual(errorCodes, [])
})

void test('buildQrScannerOptions reports scanner errors before detection and ignores them after detection', () => {
  const beforeDetectionErrors: string[] = []
  const beforeDetectionRawErrors: unknown[] = []
  const cameraError = { name: 'NotAllowedError' }

  const beforeDetection = buildQrScannerOptions({
    constraints,
    hasDetected: false,
    onError: (error) => beforeDetectionRawErrors.push(error),
    setErrorCode: (code) => beforeDetectionErrors.push(code),
    setHasDetected: () => {
      throw new Error('setHasDetected should not be called for scanner errors')
    },
    wasmUrl: '/assets/zxing_reader.wasm',
  })

  console.log('[TEST] Triggering expected scanner error before QR detection', cameraError, beforeDetection)
  beforeDetection.onError(cameraError)

  assert.deepEqual(beforeDetectionErrors, ['camera-error'])
  assert.deepEqual(beforeDetectionRawErrors, [cameraError])

  const afterDetection = buildQrScannerOptions({
    constraints,
    hasDetected: true,
    onError: () => {
      throw new Error('onError should be ignored after detection')
    },
    setErrorCode: () => {
      throw new Error('setErrorCode should be ignored after detection')
    },
    setHasDetected: () => {
      throw new Error('setHasDetected should not be called for scanner errors')
    },
    wasmUrl: '/assets/zxing_reader.wasm',
  })

  console.log('[TEST] Triggering expected scanner error after QR detection', cameraError, afterDetection)
  afterDetection.onError(cameraError)
})
