import test from 'node:test'
import assert from 'node:assert/strict'
import { ownEntry } from './records.js'

const record: Record<string, { id: string }> = { a: { id: 'a' } }

const cases: [string, string | null | undefined, { id: string } | undefined][] = [
  ['existing key', 'a', { id: 'a' }],
  ['missing key', 'z', undefined],
  ['__proto__', '__proto__', undefined],
  ['toString', 'toString', undefined],
  ['constructor', 'constructor', undefined],
  ['hasOwnProperty', 'hasOwnProperty', undefined],
  ['null', null, undefined],
  ['undefined', undefined, undefined],
  ['empty string', '', undefined],
]

for (const [name, key, expected] of cases) {
  void test(`ownEntry: ${name}`, () => {
    assert.deepEqual(ownEntry(record, key), expected)
  })
}
