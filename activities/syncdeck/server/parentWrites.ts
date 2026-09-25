import { AsyncLocalStorage } from 'node:async_hooks'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'

/**
 * The single owned mutation path for SyncDeck parent session records.
 *
 * Every writer of a `syncdeck` session record must hold that parent's write
 * lock and read the record inside it, so one writer can never write back a
 * snapshot that another writer has since changed (for example dropping a solo
 * child binding or restoring a revoked accepted entry). `guardSyncDeckParentWrites`
 * enforces this: a set/delete of a `syncdeck` record outside the lock throws.
 *
 * The lock is in-process only. Cross-instance safety needs the whole writer set
 * moved to `updateAtomic` (#313); this module is where that swap belongs.
 * See "Solo child binding" in `.agent/plans/shared-activity-runtime-authentication.md`.
 */
export const SYNCDECK_SESSION_TYPE = 'syncdeck'

export class SyncDeckParentWriteOutsideLockError extends Error {
  constructor(operation: 'set' | 'delete', sessionId: string) {
    super(`SyncDeck parent ${operation} for ${sessionId} must run inside its parent write lock`)
    this.name = 'SyncDeckParentWriteOutsideLockError'
  }
}

export interface SyncDeckParentWriter {
  /** Runs `work` while holding the parent's write lock. Not reentrant for the same parent. */
  runExclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T>
  /**
   * Takes the lock, reads the current parent, applies `mutate`, and writes it
   * unless `mutate` returns `false`. Returns the parent, or null if it is missing.
   */
  update(sessionId: string, mutate: (session: SessionRecord) => boolean | void | Promise<boolean | void>): Promise<SessionRecord | null>
  /** Whether the current async context holds this parent's write lock. */
  holds(sessionId: string): boolean
}

export function createSyncDeckParentWriter(sessions: Pick<SessionStore, 'get' | 'set'>): SyncDeckParentWriter {
  const tails = new Map<string, Promise<void>>()
  const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>()

  const holds = (sessionId: string): boolean => heldLocks.getStore()?.has(sessionId) === true

  const runExclusive = async <T>(sessionId: string, work: () => Promise<T>): Promise<T> => {
    if (holds(sessionId)) {
      throw new Error(`SyncDeck parent write lock for ${sessionId} is not reentrant`)
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

  const update: SyncDeckParentWriter['update'] = async (sessionId, mutate) => runExclusive(sessionId, async () => {
    const session = await sessions.get(sessionId)
    if (!session || session.type !== SYNCDECK_SESSION_TYPE) {
      return null
    }
    if (await mutate(session) !== false) {
      await sessions.set(sessionId, session)
    }
    return session
  })

  return { runExclusive, update, holds }
}

/**
 * Wraps the session store handed to SyncDeck's routes so any write or delete
 * of a `syncdeck` record outside its parent write lock fails loudly instead of
 * racing. Child sessions and Learn entry records are unaffected.
 */
export function guardSyncDeckParentWrites<TStore extends SessionStore>(sessions: TStore, writer: SyncDeckParentWriter): TStore {
  return new Proxy(sessions, {
    get(target, property, receiver) {
      if (property === 'set') {
        return async (id: string, session: SessionRecord, ...rest: unknown[]) => {
          if (session?.type === SYNCDECK_SESSION_TYPE && !writer.holds(id)) {
            throw new SyncDeckParentWriteOutsideLockError('set', id)
          }
          return (target.set as (...args: unknown[]) => Promise<void>).call(target, id, session, ...rest)
        }
      }
      if (property === 'delete') {
        return async (id: string) => {
          if (!writer.holds(id)) {
            const existing = await target.get(id)
            if (existing?.type === SYNCDECK_SESSION_TYPE) {
              throw new SyncDeckParentWriteOutsideLockError('delete', id)
            }
          }
          return target.delete(id)
        }
      }
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}
