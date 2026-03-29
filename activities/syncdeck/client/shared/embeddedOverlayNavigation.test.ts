import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeEmbeddedOverlayNavigationEvent } from './embeddedOverlayNavigation.js'
import { resolveOptimisticEmbeddedOverlayIndices } from './embeddedOverlayNavigation.js'
import { deriveEmbeddedOverlayVerticalNavigationCapabilities } from './embeddedOverlayNavigation.js'
import { resolveEmbeddedOverlayVerticalMoveAllowed } from './embeddedOverlayNavigation.js'
import { reduceEmbeddedOverlayNavigationPointerDownState } from './embeddedOverlayNavigation.js'
import { shouldHandleEmbeddedOverlayNavigationPointerDown } from './embeddedOverlayNavigation.js'
import { shouldNavigateEmbeddedOverlayOnPointerDown } from './embeddedOverlayNavigation.js'

void test('consumeEmbeddedOverlayNavigationEvent stops default click handling and propagation', () => {
  const calls: string[] = []

  consumeEmbeddedOverlayNavigationEvent({
    preventDefault() {
      calls.push('preventDefault')
    },
    stopPropagation() {
      calls.push('stopPropagation')
    },
  })

  assert.deepEqual(calls, ['preventDefault', 'stopPropagation'])
})

void test('reduceEmbeddedOverlayNavigationPointerDownState preserves click suppression through pointercancel and clears on click or timeout', () => {
  assert.deepEqual(
    reduceEmbeddedOverlayNavigationPointerDownState(false, 'pointerdown'),
    {
      didHandlePointerDown: true,
      shouldSkipClickNavigation: false,
    },
  )

  assert.deepEqual(
    reduceEmbeddedOverlayNavigationPointerDownState(true, 'click'),
    {
      didHandlePointerDown: false,
      shouldSkipClickNavigation: true,
    },
  )

  assert.deepEqual(
    reduceEmbeddedOverlayNavigationPointerDownState(true, 'pointercancel'),
    {
      didHandlePointerDown: true,
      shouldSkipClickNavigation: false,
    },
  )

  assert.deepEqual(
    reduceEmbeddedOverlayNavigationPointerDownState(true, 'timeout'),
    {
      didHandlePointerDown: false,
      shouldSkipClickNavigation: false,
    },
  )
})

void test('shouldHandleEmbeddedOverlayNavigationPointerDown accepts primary mouse and mobile safari touch presses', () => {
  assert.equal(
    shouldHandleEmbeddedOverlayNavigationPointerDown({
      button: 0,
      pointerType: 'mouse',
    }),
    true,
  )

  assert.equal(
    shouldHandleEmbeddedOverlayNavigationPointerDown({
      button: -1,
      pointerType: 'touch',
    }),
    true,
  )

  assert.equal(
    shouldHandleEmbeddedOverlayNavigationPointerDown({
      button: 0,
      pointerType: 'touch',
    }),
    true,
  )

  assert.equal(
    shouldHandleEmbeddedOverlayNavigationPointerDown({
      button: 1,
      pointerType: 'mouse',
    }),
    false,
  )
})

void test('shouldNavigateEmbeddedOverlayOnPointerDown defers touch navigation until click', () => {
  assert.equal(
    shouldNavigateEmbeddedOverlayOnPointerDown({
      pointerType: 'mouse',
    }),
    true,
  )

  assert.equal(
    shouldNavigateEmbeddedOverlayOnPointerDown({
      pointerType: 'pen',
    }),
    true,
  )

  assert.equal(
    shouldNavigateEmbeddedOverlayOnPointerDown({
      pointerType: 'touch',
    }),
    false,
  )
})

void test('resolveOptimisticEmbeddedOverlayIndices uses directional horizontal navigation across slide columns', () => {
  const instanceKeys = [
    'embedded-test:2:0',
    'raffle:2:1',
    'algorithm-demo:2:2',
    'video-sync:3:0',
  ]

  assert.deepEqual(
    resolveOptimisticEmbeddedOverlayIndices(instanceKeys, { h: 2, v: 0, f: 0 }, 'right'),
    { h: 3, v: 0, f: -1 },
  )

  assert.deepEqual(
    resolveOptimisticEmbeddedOverlayIndices(instanceKeys, { h: 2, v: 2, f: 0 }, 'left'),
    { h: 1, v: 0, f: -1 },
  )

  assert.deepEqual(
    resolveOptimisticEmbeddedOverlayIndices(instanceKeys, { h: 3, v: 0, f: 0 }, 'left'),
    { h: 2, v: 0, f: -1 },
  )
})

void test('resolveOptimisticEmbeddedOverlayIndices preserves vertical movement within the same slide column', () => {
  const instanceKeys = [
    'embedded-test:2:0',
    'raffle:2:1',
  ]

  assert.deepEqual(
    resolveOptimisticEmbeddedOverlayIndices(instanceKeys, { h: 2, v: 0, f: 0 }, 'down'),
    { h: 2, v: 1, f: -1 },
  )

  assert.deepEqual(
    resolveOptimisticEmbeddedOverlayIndices(instanceKeys, { h: 2, v: 1, f: 0 }, 'up'),
    { h: 2, v: 0, f: -1 },
  )
})

void test('deriveEmbeddedOverlayVerticalNavigationCapabilities enables up/down from anchored stack bounds', () => {
  const instanceKeys = [
    'embedded-test:2:0',
    'raffle:2:1',
    'algorithm-demo:2:2',
  ]

  assert.deepEqual(
    deriveEmbeddedOverlayVerticalNavigationCapabilities(instanceKeys, { h: 2, v: 0, f: 0 }),
    { canGoUp: false, canGoDown: true },
  )

  assert.deepEqual(
    deriveEmbeddedOverlayVerticalNavigationCapabilities(instanceKeys, { h: 2, v: 1, f: 0 }),
    { canGoUp: true, canGoDown: true },
  )

  assert.deepEqual(
    deriveEmbeddedOverlayVerticalNavigationCapabilities(instanceKeys, { h: 2, v: 2, f: 0 }),
    { canGoUp: true, canGoDown: false },
  )
})

void test('deriveEmbeddedOverlayVerticalNavigationCapabilities disables down when no lower anchored stack exists', () => {
  assert.deepEqual(
    deriveEmbeddedOverlayVerticalNavigationCapabilities(['embedded-test:2:0'], { h: 2, v: 0, f: 0 }),
    { canGoUp: false, canGoDown: false },
  )
})

void test('resolveEmbeddedOverlayVerticalMoveAllowed prefers iframe slide-stack capability over activity-derived bounds', () => {
  assert.equal(
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'down',
      iframeCapability: true,
      derivedCapabilities: { canGoUp: true, canGoDown: false },
      fallbackAllowed: true,
    }),
    true,
  )

  assert.equal(
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'up',
      iframeCapability: false,
      derivedCapabilities: { canGoUp: true, canGoDown: false },
      fallbackAllowed: false,
    }),
    false,
  )
})

void test('resolveEmbeddedOverlayVerticalMoveAllowed falls back to derived bounds and local default when iframe capability is unavailable', () => {
  assert.equal(
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'down',
      iframeCapability: null,
      derivedCapabilities: { canGoUp: false, canGoDown: true },
      fallbackAllowed: false,
    }),
    true,
  )

  assert.equal(
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'up',
      iframeCapability: null,
      derivedCapabilities: null,
      fallbackAllowed: true,
    }),
    true,
  )
})
