import test from 'node:test'
import assert from 'node:assert/strict'
import { copyTextWithReset } from './useClipboard'

test('copyTextWithReset copies text and schedules reset', async () => {
  let copiedText: string | null = null
  const scheduledCallbacks: Array<() => void> = []
  let scheduledDelay: number | null = null
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }
  const timeoutHandle = { id: 1 } as unknown as ReturnType<typeof setTimeout>
  const setTimeoutFn = ((callback: Parameters<typeof setTimeout>[0], delay?: Parameters<typeof setTimeout>[1]) => {
    assert.equal(typeof callback, 'function')
    scheduledCallbacks.push(callback as () => void)
    scheduledDelay = Number(delay)
    return timeoutHandle
  }) as unknown as typeof setTimeout

  const copied = await copyTextWithReset('session-123', {
    writeText: async (text) => {
      assert.equal(text, 'session-123')
    },
    setCopiedText: (text) => {
      copiedText = text
    },
    timeoutRef,
    resetDelay: 1500,
    setTimeoutFn,
  })

  assert.equal(copied, true)
  assert.equal(copiedText, 'session-123')
  assert.equal(timeoutRef.current, timeoutHandle)
  assert.equal(scheduledDelay, 1500)

  assert.equal(scheduledCallbacks.length, 1)
  scheduledCallbacks[0]?.()
  assert.equal(copiedText, null)
  assert.equal(timeoutRef.current, null)
})

test('copyTextWithReset clears previous timer before scheduling a new one', async () => {
  let copiedText: string | null = null
  const clearedTimers: Array<ReturnType<typeof setTimeout>> = []
  const previousHandle = { id: 1 } as unknown as ReturnType<typeof setTimeout>
  const newHandle = { id: 2 } as unknown as ReturnType<typeof setTimeout>
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: previousHandle }

  const copied = await copyTextWithReset('new-value', {
    writeText: async () => {},
    setCopiedText: (text) => {
      copiedText = text
    },
    timeoutRef,
    resetDelay: 500,
    setTimeoutFn: (() => newHandle) as unknown as typeof setTimeout,
    clearTimeoutFn: ((handle) => {
      clearedTimers.push(handle as ReturnType<typeof setTimeout>)
    }) as typeof clearTimeout,
  })

  assert.equal(copied, true)
  assert.deepEqual(clearedTimers, [previousHandle])
  assert.equal(copiedText, 'new-value')
  assert.equal(timeoutRef.current, newHandle)
})

test('copyTextWithReset returns false for missing text', async () => {
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }
  let writeCalls = 0

  const copied = await copyTextWithReset('', {
    writeText: async () => {
      writeCalls += 1
    },
    setCopiedText: () => {},
    timeoutRef,
    resetDelay: 1000,
  })

  assert.equal(copied, false)
  assert.equal(writeCalls, 0)
  assert.equal(timeoutRef.current, null)
})

test('copyTextWithReset returns false and reports write errors', async () => {
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }
  const expectedError = new Error('clipboard unavailable')
  let observedError: unknown = null
  let copiedText: string | null = 'existing'

  const copied = await copyTextWithReset('will-fail', {
    writeText: async () => {
      throw expectedError
    },
    setCopiedText: (text) => {
      copiedText = text
    },
    timeoutRef,
    resetDelay: 1000,
    onError: (error) => {
      observedError = error
    },
  })

  assert.equal(copied, false)
  assert.equal(observedError, expectedError)
  assert.equal(copiedText, 'existing')
  assert.equal(timeoutRef.current, null)
})
