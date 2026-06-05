import assert from 'node:assert/strict'
import test from 'node:test'
import { ChangeSet, Text } from '@codemirror/state'
import { createRemotePresenceDecorations, mapRemotePresenceDecorations } from './CodeEditor'

void test('remote presence decorations map through document changes', () => {
  const doc = Text.of(['hello'])
  const decorations = createRemotePresenceDecorations(
    {
      path: 'Main.java',
      selections: [{ anchor: 1, head: 4 }],
    },
    'Main.java',
  )

  const insertPrefix = ChangeSet.of([{ from: 0, insert: 'xy' }], doc.length)
  const mapped = mapRemotePresenceDecorations(decorations, insertPrefix)
  const ranges: Array<{ from: number; to: number }> = []

  mapped.between(0, doc.length + 2, (from, to) => {
    ranges.push({ from, to })
  })

  assert.deepEqual(ranges, [
    { from: 3, to: 6 },
    { from: 6, to: 6 },
  ])
})
