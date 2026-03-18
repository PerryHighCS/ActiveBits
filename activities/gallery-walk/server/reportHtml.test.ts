import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGalleryWalkReportFilename,
  buildGalleryWalkReportHtml,
  buildGalleryWalkStructuredReportSection,
  type GalleryWalkReportBundle,
} from './reportHtml.js'

function createBundle(overrides: Partial<GalleryWalkReportBundle> = {}): GalleryWalkReportBundle {
  return {
    version: 1,
    exportedAt: Date.parse('2026-03-18T12:00:00Z'),
    sessionId: 'gw-session-1',
    reviewees: {
      studentA: { name: 'Avery', projectTitle: 'Bridge Design' },
      studentB: { name: 'Blair' },
    },
    reviewers: {
      reviewer1: { name: 'Jordan' },
      reviewer2: { name: 'Sam' },
    },
    feedback: [
      {
        id: 'fb-1',
        to: 'studentA',
        from: 'reviewer1',
        fromNameSnapshot: 'Jordan',
        message: 'Strong prototype and clear explanation.',
        createdAt: Date.parse('2026-03-18T11:00:00Z'),
        styleId: 'yellow',
      },
      {
        id: 'fb-2',
        to: 'studentB',
        from: 'reviewer2',
        fromNameSnapshot: 'Sam',
        message: 'Consider adding more visual labels.',
        createdAt: Date.parse('2026-03-18T11:30:00Z'),
        styleId: 'blue',
      },
    ],
    stats: {
      reviewees: {
        studentA: 1,
        studentB: 1,
      },
      reviewers: {
        reviewer1: 1,
        reviewer2: 1,
      },
    },
    stage: 'review',
    config: {
      title: 'Bridge Critique Round',
    },
    ...overrides,
  }
}

void test('buildGalleryWalkReportFilename uses the configured title when present', () => {
  assert.equal(buildGalleryWalkReportFilename(createBundle()), 'bridge-critique-round.html')
})

void test('buildGalleryWalkReportHtml emits a self-contained HTML report with whole-class and per-student views', () => {
  const html = buildGalleryWalkReportHtml(createBundle())

  assert.match(html, /<!DOCTYPE html>/)
  assert.match(html, /Gallery Walk Report/)
  assert.match(html, /Whole Class/)
  assert.match(html, /Per Student/)
  assert.match(html, /Bridge Critique Round/)
  assert.match(html, /Bridge Design/)
  assert.match(html, /Avery/)
  assert.match(html, /Strong prototype and clear explanation\./)
  assert.match(html, /<script id="report-data" type="application\/json">/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /<link[^>]+href=/)
})

void test('buildGalleryWalkReportHtml escapes embedded data safely', () => {
  const html = buildGalleryWalkReportHtml(createBundle({
    config: { title: 'Unsafe </script> Title' },
    feedback: [
      {
        id: 'fb-x',
        to: 'studentA',
        from: 'reviewer1',
        fromNameSnapshot: 'Jordan',
        message: '<b>Needs escaping</b>',
        createdAt: Date.parse('2026-03-18T11:00:00Z'),
        styleId: 'yellow',
      },
    ],
  }))

  assert.doesNotMatch(html, /<title>Unsafe <\/script> Title<\/title>/)
  assert.match(html, /Unsafe &lt;\/script&gt; Title/)
  assert.match(html, /\\u003c\/script\\u003e/)
})

void test('buildGalleryWalkStructuredReportSection returns aggregate-friendly structured data', () => {
  const section = buildGalleryWalkStructuredReportSection(createBundle(), {
    instanceKey: 'gallery-walk:4:0',
  })

  assert.equal(section.activityId, 'gallery-walk')
  assert.equal(section.childSessionId, 'gw-session-1')
  assert.equal(section.instanceKey, 'gallery-walk:4:0')
  assert.deepEqual(section.supportsScopes, ['activity-session', 'student-cross-activity', 'session-summary'])
  assert.equal(section.students?.[0]?.studentId, 'studentA')
  assert.equal(section.summaryCards?.[0]?.metrics?.[0]?.label, 'Feedback Entries')
  assert.deepEqual(section.payload.stats, {
    reviewees: {
      studentA: 1,
      studentB: 1,
    },
    reviewers: {
      reviewer1: 1,
      reviewer2: 1,
    },
  })
})
