import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * In-process, per-session write lock shared by every writer that reads a
 * session record, may await other work, and then writes the record back.
 *
 * Activity-agnostic: shared platform routes (entry-participant, consume,
 * persistent capability issuance) and activity-owned mutation paths (for
 * example SyncDeck's `parentWrites.ts`) take the same lock, so within one
 * process no writer can write back a snapshot another writer has since
 * changed. Ownership is tracked per async context, so only the code running
 * inside `runSessionWriteExclusive` holds the lock.
 *
 * This does not coordinate across server instances; cross-instance safety is
 * `SessionStore.updateAtomic` (#313). The lock is not reentrant for one session.
 */
const tails = new Map<string, Promise<void>>()
const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>()

export class SessionWriteLockReentryError extends Error {
  constructor(sessionId: string) {
    super(`Session write lock for ${sessionId} is not reentrant`)
    this.name = 'SessionWriteLockReentryError'
  }
}

/** Whether the current async context holds the write lock for `sessionId`. */
export function holdsSessionWriteLock(sessionId: string): boolean {
  return heldLocks.getStore()?.has(sessionId) === true
}

/** Runs `work` while holding `sessionId`'s write lock; writers for that session run one at a time. */
export async function runSessionWriteExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  if (holdsSessionWriteLock(sessionId)) {
    throw new SessionWriteLockReentryError(sessionId)
  }
  const previous = tails.get(sessionId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current, () => current)
  tails.set(sessionId, queued)

  await previous
  try {
    const held = new Set(heldLocks.getStore() ?? [])
    held.add(sessionId)
    return await heldLocks.run(held, work)
  } finally {
    release()
    if (tails.get(sessionId) === queued) {
      tails.delete(sessionId)
    }
  }
}
