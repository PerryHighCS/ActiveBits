import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionCache } from './sessionCache.js'

interface TestSession {
  rev?: number
  created?: number
  [key: string]: unknown
}

void test('SessionCache.replaceStaleFill publishes a fill nothing raced', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  const token = cache.beginFill('a')
  cache.replaceStaleFill('a', { rev: 1 }, token)
  assert.deepEqual(cache.getFresh('a'), { rev: 1 })
})

void test('SessionCache.replaceStaleFill keeps the later-started concurrent fill across an incarnation swap', () => {
  const cache = new SessionCache<TestSession>({
    ttlMs: 10_000,
    supersedes: (incoming, cached) =>
      incoming.created === cached.created && (incoming.rev ?? 0) > (cached.rev ?? 0),
  })
  const oldIncarnationToken = cache.beginFill('a')
  const replacementIncarnationToken = cache.beginFill('a')

  // The old read completes first but was superseded when the later strict read
  // began. Its different incarnation cannot prove freshness and is dropped.
  cache.replaceStaleFill('a', { created: 1, rev: 0, generation: 'old' }, oldIncarnationToken)
  cache.replaceStaleFill('a', { created: 2, rev: 0, generation: 'replacement' }, replacementIncarnationToken)

  assert.deepEqual(cache.getFresh('a'), { created: 2, rev: 0, generation: 'replacement' })
})

void test('SessionCache.clear invalidates a pending cold fill', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  const token = cache.beginFill('cold')

  cache.clear()
  cache.replaceStaleFill('cold', { rev: 1, stale: true }, token)

  assert.equal(cache.getFresh('cold'), null)
})

void test('SessionCache.replaceStaleFill drops a fill when a set raced the await', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  const token = cache.beginFill('a')
  cache.set('a', { rev: 5 }, false) // a concurrent commit
  cache.replaceStaleFill('a', { rev: 1, stale: true }, token)
  assert.deepEqual(cache.getFresh('a'), { rev: 5 }, 'the newer committed value is kept')
})

void test('SessionCache.replaceStaleFill drops a fill when an invalidate raced the await', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  cache.set('a', { rev: 1 }, false)
  const token = cache.beginFill('a')
  cache.invalidate('a') // a concurrent delete
  cache.replaceStaleFill('a', { rev: 1, stale: true }, token)
  assert.equal(cache.getFresh('a'), null, 'the emptied slot is not repopulated')
})

void test('SessionCache.replaceStaleFill still publishes a same-incarnation newer revision when supersedes allows it', () => {
  const cache = new SessionCache<TestSession>({
    ttlMs: 10_000,
    supersedes: (incoming, cached) =>
      incoming.created === cached.created && (incoming.rev ?? 0) >= (cached.rev ?? 0),
  })
  cache.set('a', { created: 1, rev: 1 }, false)
  const token = cache.beginFill('a')
  cache.set('a', { created: 1, rev: 1 }, false) // some other write bumps the generation
  // The fill carries revision 3 for the same incarnation - newer than cached.
  cache.replaceStaleFill('a', { created: 1, rev: 3 }, token)
  assert.deepEqual(cache.getFresh('a'), { created: 1, rev: 3 })
})

void test('SessionCache.replaceStaleFill does not republish a snapshot after the id was capacity-evicted mid-fill', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000, maxSize: 1 })
  cache.set('b', { rev: 1 }, false)
  // The fill observes the cached entry before its await. Capacity eviction is
  // the only generation change between that read and the late result.
  const token = cache.beginFill('b')
  cache.set('c', { rev: 1 }, false) // capacity eviction removes 'b'
  assert.equal(cache.getFresh('b'), null)

  // The stalled fill completes with the pre-eviction snapshot.
  cache.replaceStaleFill('b', { rev: 0, stale: true }, token)
  assert.equal(cache.getFresh('b'), null, 'the evicted id is not resurrected by the late fill')
})

void test('SessionCache.replaceStaleFill does not republish a snapshot after cleanup() pruned the generation mid-fill', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 1 })
  cache.set('b', { rev: 1 }, false)
  const token = cache.beginFill('b')
  // Let the observed entry age past the TTL, then sweep it (and its generation entry).
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 1_000
    cache.cleanup()
  } finally {
    Date.now = realNow
  }
  assert.equal(cache.getFresh('b'), null)

  cache.replaceStaleFill('b', { rev: 0, stale: true }, token)
  assert.equal(cache.getFresh('b'), null, 'a stalled fill cannot collide onto a pruned generation after cleanup()')
})

void test('SessionCache.getFresh expiry invalidates a stalled fill before returning a cache miss', () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 1 })
  cache.set('b', { rev: 1 }, false)
  const token = cache.beginFill('b')
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 1_000
    assert.equal(cache.getFresh('b'), null)
  } finally {
    Date.now = realNow
  }

  cache.replaceStaleFill('b', { rev: 0, stale: true }, token)
  assert.equal(cache.getFresh('b'), null, 'an expired read cannot be restored by its stalled fill')
})

void test('SessionCache.get routes its cache-miss fill through the stale-fill guard', async () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })

  // Stalled cache-miss load for 'a'.
  const stalled = cache.get('a', async () => {
    await gate
    return { rev: 0, stale: true }
  })
  // A commit lands and caches a newer value while the load is stalled.
  cache.set('a', { rev: 2 }, false)

  release()
  await stalled
  assert.deepEqual(cache.getFresh('a'), { rev: 2 }, 'the stalled cache-miss load did not roll the cache back')
})

void test('SessionCache.get does not let a stale miss invalidate a concurrent write', async () => {
  const cache = new SessionCache<TestSession>({ ttlMs: 10_000 })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })

  const stalledMiss = cache.get('a', async () => {
    await gate
    return null
  })
  cache.set('a', { rev: 2 }, false)

  release()
  await stalledMiss
  assert.deepEqual(cache.getFresh('a'), { rev: 2 }, 'the stalled miss did not delete the concurrent write')
})
