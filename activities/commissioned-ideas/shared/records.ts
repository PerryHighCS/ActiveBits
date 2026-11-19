/**
 * Own-property lookup for id-keyed session maps (teams, roster, ballots).
 * Every lookup by a client-supplied id goes through this: plain objects inherit
 * `__proto__`, `toString`, `constructor`, … which a bare `record[id]` would return.
 */
export function ownEntry<T>(record: Record<string, T>, key: string | null | undefined): T | undefined {
  if (typeof key !== 'string' || !Object.hasOwn(record, key)) return undefined
  return record[key]
}
