import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getActivityReportBuilder,
  registerActivityReportBuilder,
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

let activityTypeCounter = 0

function nextTestActivityType(label: string): string {
  activityTypeCounter += 1
  return `__activity-report-registry-test__:${label}:${activityTypeCounter}`
}

void test('registerActivityReportBuilder validates inputs', () => {
  assert.throws(
    () => registerActivityReportBuilder('', createBuilder('x')),
    /non-empty activity type string/,
  )
  assert.throws(
    () => registerActivityReportBuilder(nextTestActivityType('invalid-builder'), null as unknown as ActivityReportBuilder),
    /requires a function/,
  )
})

void test('registerActivityReportBuilder warns and overrides duplicates outside development mode', () => {
  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }

  try {
    const first = createBuilder('first')
    const second = createBuilder('second')
    const activityType = nextTestActivityType('duplicate')

    registerActivityReportBuilder(activityType, first)
    registerActivityReportBuilder(activityType, second)

    assert.equal(getActivityReportBuilder(activityType), second)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', new RegExp(`Overriding activity report builder for "${activityType}"`))
  } finally {
    console.warn = originalWarn
  }
})
