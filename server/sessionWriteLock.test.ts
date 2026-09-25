import test from 'node:test'
import assert from 'node:assert/strict'
import { holdsSessionWriteLock, runSessionWriteExclusive, SessionWriteLockReentryError } from './core/sessionWriteLock.js'

void test('runSessionWriteExclusive serializes writers per session and runs other sessions independently', async () => {
  const order: string[] = []
  const work = (label: string, ms: number) => async () => {
    order.push(`${label}:start`)
    await new Promise((resolve) => setTimeout(resolve, ms))
    order.push(`${label}:end`)
  }

  await Promise.all([
    runSessionWriteExclusive('lock-a', work('first', 15)),
    runSessionWriteExclusive('lock-a', work('second', 1)),
    runSessionWriteExclusive('lock-b', work('other', 1)),
  ])

  assert.ok(order.indexOf('first:end') < order.indexOf('second:start'), order.join(','))
  assert.ok(order.indexOf('other:end') < order.indexOf('first:end'), order.join(','))
})

void test('session write lock ownership is scoped to the async context that holds it', async () => {
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  let signalHeld!: () => void
  const held = new Promise<void>((resolve) => { signalHeld = resolve })

  const holder = runSessionWriteExclusive('lock-scope', async () => {
    assert.equal(holdsSessionWriteLock('lock-scope'), true)
    assert.equal(holdsSessionWriteLock('lock-other'), false)
    signalHeld()
    await released
  })
  await held
  assert.equal(holdsSessionWriteLock('lock-scope'), false)
  release()
  await holder
  assert.equal(holdsSessionWriteLock('lock-scope'), false)
})

void test('session write lock rejects reentry and is released after a failure', async () => {
  await assert.rejects(
    runSessionWriteExclusive('lock-reentry', async () => runSessionWriteExclusive('lock-reentry', async () => undefined)),
    SessionWriteLockReentryError,
  )
  await assert.rejects(runSessionWriteExclusive('lock-reentry', async () => { throw new Error('[TEST] expected failure') }))
  assert.equal(await runSessionWriteExclusive('lock-reentry', async () => 'next'), 'next')
})
