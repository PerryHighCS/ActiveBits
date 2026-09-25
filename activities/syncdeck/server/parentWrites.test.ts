import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import {
  createSyncDeckParentWriter,
  guardSyncDeckParentWrites,
  SyncDeckParentWriteOutsideLockError,
} from './parentWrites.js'

function createStore(initial: SessionRecord[]) {
  const records = new Map(initial.map((record) => [record.id, structuredClone(record)]))
  const store = {
    async get(id: string) {
      const record = records.get(id)
      return record ? structuredClone(record) : null
    },
    async set(id: string, session: SessionRecord) {
      records.set(id, structuredClone(session))
    },
    async delete(id: string) {
      return records.delete(id)
    },
    async touch() {
      return true
    },
  } as unknown as SessionStore
  return { store, records }
}

function deck(id: string, data: Record<string, unknown> = {}): SessionRecord {
  return { id, type: 'syncdeck', created: 1, lastActivity: 1, data }
}

function child(id: string): SessionRecord {
  return { id, type: 'resonance', created: 1, lastActivity: 1, data: {} }
}

void test('guarded store: parent writes require the parent lock; other records do not', async () => {
  const { store } = createStore([deck('d1'), deck('d2'), child('CHILD:d1:a:resonance')])
  const writer = createSyncDeckParentWriter(store)
  const guarded = guardSyncDeckParentWrites(store, writer)

  // Decision table: record type x lock held for that id x operation.
  await assert.rejects(guarded.set('d1', deck('d1', { v: 1 })), SyncDeckParentWriteOutsideLockError)
  await assert.rejects(guarded.delete('d1'), SyncDeckParentWriteOutsideLockError)
  await writer.runExclusive('d1', async () => {
    await guarded.set('d1', deck('d1', { v: 2 }))
    // Holding d1's lock does not authorize writes to another parent.
    await assert.rejects(guarded.set('d2', deck('d2', { v: 2 })), SyncDeckParentWriteOutsideLockError)
  })
  await guarded.set('CHILD:d1:a:resonance', child('CHILD:d1:a:resonance'))
  await guarded.set('learn-entry', { id: 'learn-entry', type: 'learn-syncdeck-entry', created: 1, lastActivity: 1, data: {} })
  assert.equal(await guarded.delete('CHILD:d1:a:resonance'), true)
  assert.equal(await guarded.delete('missing'), false)
  await writer.runExclusive('d1', async () => {
    assert.equal(await guarded.delete('d1'), true)
  })
})

void test('lock ownership follows the async context, not wall-clock overlap', async () => {
  const { store } = createStore([deck('d1')])
  const writer = createSyncDeckParentWriter(store)
  const guarded = guardSyncDeckParentWrites(store, writer)
  let releaseHolder!: () => void
  const holderWaiting = new Promise<void>((resolve) => { releaseHolder = resolve })
  let signalHeld!: () => void
  const held = new Promise<void>((resolve) => { signalHeld = resolve })

  const holder = writer.runExclusive('d1', async () => {
    signalHeld()
    await holderWaiting
  })
  await held
  // Another request running while the lock is held elsewhere is still rejected.
  assert.equal(writer.holds('d1'), false)
  await assert.rejects(guarded.set('d1', deck('d1', { v: 1 })), SyncDeckParentWriteOutsideLockError)
  releaseHolder()
  await holder
})

void test('runExclusive serializes work per parent and is not reentrant', async () => {
  const { store } = createStore([deck('d1'), deck('d2')])
  const writer = createSyncDeckParentWriter(store)
  const order: string[] = []
  const slow = (label: string, ms: number) => async () => {
    order.push(`${label}:start`)
    await new Promise((resolve) => setTimeout(resolve, ms))
    order.push(`${label}:end`)
  }

  await Promise.all([
    writer.runExclusive('d1', slow('a', 15)),
    writer.runExclusive('d1', slow('b', 1)),
    writer.runExclusive('d2', slow('c', 1)),
  ])
  assert.ok(order.indexOf('a:end') < order.indexOf('b:start'), order.join(','))
  assert.ok(order.indexOf('c:end') < order.indexOf('a:end'), order.join(','))

  await assert.rejects(
    writer.runExclusive('d1', async () => writer.runExclusive('d1', async () => undefined)),
    /not reentrant/,
  )
  // A failed unit of work releases the lock for the next writer.
  await assert.rejects(writer.runExclusive('d1', async () => { throw new Error('[TEST] expected failure') }))
  assert.equal(await writer.runExclusive('d1', async () => 'next'), 'next')
})

void test('update re-reads the current parent, skips the write on false, and ignores non-parents', async () => {
  const { store, records } = createStore([deck('d1', { a: 1 }), child('CHILD:d1:a:resonance')])
  const writer = createSyncDeckParentWriter(store)

  // Concurrent updates of different fields both survive.
  await Promise.all([
    writer.update('d1', (session) => { session.data.b = 2 }),
    writer.update('d1', (session) => { session.data.c = 3 }),
  ])
  assert.deepEqual(records.get('d1')?.data, { a: 1, b: 2, c: 3 })

  const unchanged = await writer.update('d1', (session) => {
    session.data.a = 99
    return false
  })
  assert.equal(unchanged?.data.a, 99)
  assert.equal(records.get('d1')?.data.a, 1)

  assert.equal(await writer.update('missing', () => undefined), null)
  assert.equal(await writer.update('CHILD:d1:a:resonance', () => undefined), null)
})
