import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostedFragmentRecord } from '../wwwSimTypes.js'
import {
  createHash,
  createHostingMap,
  dividePassage,
  generateHtmlTemplate,
  verifyHostname,
} from './routeUtils.js'

function sequenceRandom(values: number[]): () => number {
  let index = 0
  return () => {
    const next = values[index % values.length] ?? 0
    index += 1
    return next
  }
}

test('verifyHostname accepts and rejects expected values', () => {
  assert.equal(verifyHostname('student-1'), true)
  assert.equal(verifyHostname('Student-1'), true)
  assert.equal(verifyHostname('student_1'), false)
  assert.equal(verifyHostname('-invalid'), false)
})

test('dividePassage splits words into requested segment count', () => {
  const fragments = dividePassage('one two three four five six', 3)
  assert.deepEqual(fragments, ['one two', 'three four', 'five six'])
})

test('createHash returns deterministic sha256 output', () => {
  const hash = createHash('hello world')
  assert.equal(hash.length, 64)
  assert.equal(hash, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
})

test('createHostingMap assigns all fragments and ensures each student hosts at least three files', () => {
  const hostingMap = createHostingMap(
    [
      { hostname: 'alpha', joined: 1 },
      { hostname: 'beta', joined: 2 },
    ],
    {
      value: 'one two three four five six seven eight nine ten',
      adjectives: ['calm', 'quick', 'steady'],
      nouns: ['fox', 'bear', 'owl'],
    },
  )

  assert.equal(hostingMap.length, 5)
  const assignmentCount = new Map<string, number>([
    ['alpha', 0],
    ['beta', 0],
  ])

  for (const fragment of hostingMap) {
    assert.ok(fragment.fragment.length > 0)
    for (const assignment of fragment.assignedTo) {
      assignmentCount.set(assignment.hostname, (assignmentCount.get(assignment.hostname) ?? 0) + 1)
    }
  }

  assert.ok((assignmentCount.get('alpha') ?? 0) >= 3)
  assert.ok((assignmentCount.get('beta') ?? 0) >= 3)
})

test('generateHtmlTemplate prefers non-self sources when alternatives exist', () => {
  const fragmentRecords: HostedFragmentRecord[] = [
    {
      fragment: 'fragment-a',
      index: 0,
      hash: 'hash-a',
      assignedTo: [
        { hostname: 'alpha', fileName: 'alpha-a' },
        { hostname: 'beta', fileName: 'beta-a' },
      ],
    },
    {
      fragment: 'fragment-b',
      index: 1,
      hash: 'hash-b',
      assignedTo: [{ hostname: 'alpha', fileName: 'alpha-b' }],
    },
  ]

  const template = generateHtmlTemplate('alpha', fragmentRecords, 'Sample Title', sequenceRandom([0]))
  assert.equal(template.title, 'Sample Title')
  assert.deepEqual(template.fragments, [
    { hash: 'hash-a', url: 'http://beta/beta-a' },
    { hash: 'hash-b', url: 'http://alpha/alpha-b' },
  ])
})
