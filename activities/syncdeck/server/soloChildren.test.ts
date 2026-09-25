import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSoloChildOptionsKey,
  findBoundSoloChild,
  MAX_SOLO_CHILDREN_PER_SESSION,
  MAX_SOLO_CHILDREN_PER_STUDENT,
  normalizeSoloChildren,
  recordSoloChild,
  removeStudentSoloChildren,
  type SyncDeckSoloChildRecord,
  type SyncDeckSoloChildrenMap,
} from './soloChildren.js'

function record(overrides: Partial<SyncDeckSoloChildRecord> = {}): SyncDeckSoloChildRecord {
  return {
    studentId: 'student-1',
    activityId: 'resonance',
    instanceKey: 'resonance:1:0',
    optionsKey: 'options-a',
    createdAt: 1,
    ...overrides,
  }
}

void test('normalizeSoloChildren keeps complete records and drops malformed or missing input', () => {
  assert.deepEqual(normalizeSoloChildren(undefined), {})
  assert.deepEqual(normalizeSoloChildren(null), {})
  assert.deepEqual(normalizeSoloChildren([record()]), {})
  assert.deepEqual(normalizeSoloChildren('CHILD:s1:a:resonance'), {})

  const normalized = normalizeSoloChildren({
    'CHILD:s1:a:resonance': record(),
    'CHILD:s1:b:resonance': { ...record(), studentId: '' },
    'CHILD:s1:c:resonance': { ...record(), createdAt: Number.NaN },
    'CHILD:s1:d:resonance': { ...record(), optionsKey: 7 },
    'CHILD:s1:e:resonance': 'not-a-record',
    '  ': record(),
  })
  assert.deepEqual(normalized, { 'CHILD:s1:a:resonance': record() })
})

void test('buildSoloChildOptionsKey ignores key order and distinguishes different values', () => {
  const base = buildSoloChildOptionsKey({ a: 1, nested: { x: [1, 2], y: 'z' } })
  assert.equal(buildSoloChildOptionsKey({ nested: { y: 'z', x: [1, 2] }, a: 1 }), base)
  assert.notEqual(buildSoloChildOptionsKey({ a: 1, nested: { x: [2, 1], y: 'z' } }), base)
  assert.notEqual(buildSoloChildOptionsKey({ a: '1', nested: { x: [1, 2], y: 'z' } }), base)
  assert.notEqual(buildSoloChildOptionsKey({}), base)
})

void test('findBoundSoloChild matches only when student, activity, slide, and options all match', () => {
  const soloChildren: SyncDeckSoloChildrenMap = { 'CHILD:s1:a:resonance': record() }
  const match = { studentId: 'student-1', activityId: 'resonance', instanceKey: 'resonance:1:0', optionsKey: 'options-a' }

  assert.equal(findBoundSoloChild(soloChildren, match), 'CHILD:s1:a:resonance')
  assert.equal(findBoundSoloChild(soloChildren, { ...match, studentId: 'student-2' }), null)
  assert.equal(findBoundSoloChild(soloChildren, { ...match, activityId: 'video-sync' }), null)
  assert.equal(findBoundSoloChild(soloChildren, { ...match, instanceKey: 'resonance:2:0' }), null)
  assert.equal(findBoundSoloChild(soloChildren, { ...match, optionsKey: 'options-b' }), null)
  assert.equal(findBoundSoloChild({}, match), null)
})

void test('recordSoloChild evicts the oldest records past the per-student cap without touching other students', () => {
  const soloChildren: SyncDeckSoloChildrenMap = { 'other-student-child': record({ studentId: 'student-2', createdAt: 0 }) }
  const evicted: string[] = []
  for (let index = 0; index <= MAX_SOLO_CHILDREN_PER_STUDENT; index += 1) {
    evicted.push(...recordSoloChild(soloChildren, `child-${index}`, record({ createdAt: index + 1 })))
  }

  assert.deepEqual(evicted, ['child-0'])

  const studentOneChildren = Object.keys(soloChildren).filter((id) => soloChildren[id]!.studentId === 'student-1')
  assert.equal(studentOneChildren.length, MAX_SOLO_CHILDREN_PER_STUDENT)
  assert.equal(soloChildren['child-0'], undefined)
  assert.ok(soloChildren[`child-${MAX_SOLO_CHILDREN_PER_STUDENT}`])
  assert.ok(soloChildren['other-student-child'])
})

void test('recordSoloChild evicts the oldest records past the per-session cap', () => {
  const soloChildren: SyncDeckSoloChildrenMap = {}
  const evicted: string[] = []
  for (let index = 0; index <= MAX_SOLO_CHILDREN_PER_SESSION; index += 1) {
    evicted.push(...recordSoloChild(soloChildren, `child-${index}`, record({ studentId: `student-${index}`, createdAt: index })))
  }

  assert.deepEqual(evicted, ['child-0'])

  assert.equal(Object.keys(soloChildren).length, MAX_SOLO_CHILDREN_PER_SESSION)
  assert.equal(soloChildren['child-0'], undefined)
})

void test('removeStudentSoloChildren deletes only that student and returns the affected child IDs', () => {
  const soloChildren: SyncDeckSoloChildrenMap = {
    a: record(),
    b: record({ instanceKey: 'resonance:2:0' }),
    c: record({ studentId: 'student-2' }),
  }

  assert.deepEqual(removeStudentSoloChildren(soloChildren, 'student-1').sort(), ['a', 'b'])
  assert.deepEqual(Object.keys(soloChildren), ['c'])
  assert.deepEqual(removeStudentSoloChildren(soloChildren, 'missing-student'), [])
})
