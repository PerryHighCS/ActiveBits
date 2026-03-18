import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getActivityReportBuilder,
  registerActivityReportBuilder,
  resetActivityReportBuildersForTests,
  type ActivityReportBuilder,
} from './activities/activityReportRegistry.js'

function createBuilder(label: string): ActivityReportBuilder {
  return (_session, { instanceKey }) => ({
    activityId: label,
    childSessionId: `${label}-child`,
    instanceKey,
    title: label,
    generatedAt: 1,
    supportsScopes: ['activity-session'],
    payload: {},
  })
}

void test('registerActivityReportBuilder validates inputs', () => {
  resetActivityReportBuildersForTests()

  assert.throws(
    () => registerActivityReportBuilder('', createBuilder('x')),
    /non-empty activity type string/,
  )
  assert.throws(
    () => registerActivityReportBuilder('gallery-walk', null as unknown as ActivityReportBuilder),
    /requires a function/,
  )
})

void test('registerActivityReportBuilder warns and overrides duplicates outside development mode', () => {
  resetActivityReportBuildersForTests()

  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }

  try {
    const first = createBuilder('first')
    const second = createBuilder('second')

    registerActivityReportBuilder('gallery-walk', first)
    registerActivityReportBuilder('gallery-walk', second)

    assert.equal(getActivityReportBuilder('gallery-walk'), second)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /Overriding activity report builder for "gallery-walk"/)
  } finally {
    console.warn = originalWarn
    resetActivityReportBuildersForTests()
  }
})
