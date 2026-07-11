import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPostboardReportBundle,
  buildPostboardReportFilename,
  buildPostboardReportHtml,
  buildPostboardStructuredReportSection,
} from './reportHtml.js'
import { buildReactionCounts, normalizePostboardSessionData } from './routes.js'

function createBundle() {
  const data = normalizePostboardSessionData({
    instructorPasscode: 'teacher-pass',
    prompt: {
      id: 'prompt-1',
      text: 'Share a debugging strategy',
      createdAt: 100,
      updatedAt: 100,
    },
    settings: { autoApprove: false },
    posts: [
      {
        id: 'post-1',
        promptId: 'prompt-1',
        authorId: 'student-1',
        authorName: 'Ada Lovelace',
        authorRole: 'student',
        text: 'Trace the loop state.',
        styleId: 'lemon',
        createdAt: 100,
        updatedAt: 100,
        status: 'approved',
        approvedAt: 100,
        rejectedAt: null,
        deletedAt: null,
        hiddenAt: null,
        order: 0,
      },
      {
        id: 'post-2',
        promptId: 'prompt-1',
        authorId: 'student-2',
        authorName: 'Grace Hopper',
        authorRole: 'student',
        text: 'Read the error from the bottom up.',
        styleId: 'sky',
        createdAt: 110,
        updatedAt: 120,
        status: 'rejected',
        approvedAt: null,
        rejectedAt: 120,
        deletedAt: null,
        hiddenAt: null,
        order: 1,
      },
    ],
    reactions: {
      'post-1': { byUser: { 'student-2': '👍', instructor: '💡' } },
    },
    flags: {
      'post-2': [
        {
          id: 'flag-1',
          postId: 'post-2',
          flaggedBy: 'instructor',
          reason: 'Needs revision',
          createdAt: 130,
        },
      ],
    },
  })

  return buildPostboardReportBundle({
    sessionId: 'postboard-session-1',
    data,
    reactionCounts: buildReactionCounts(data.reactions),
  })
}

void test('buildPostboardReportHtml returns a self-contained instructor report', () => {
  const html = buildPostboardReportHtml(createBundle())

  assert.match(html, /<!DOCTYPE html>/)
  assert.match(html, /Postboard Report/)
  assert.match(html, /Share a debugging strategy/)
  assert.match(html, /Trace the loop state\./)
  assert.match(html, /Needs revision/)
  assert.match(html, /👍 1, 💡 1/)
  assert.match(html, /<script id="postboard-report-data" type="application\/json">/)
  assert.doesNotMatch(html, /teacher-pass/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /<link[^>]+href=/)
})

void test('buildPostboardStructuredReportSection includes status, reactions, flags, and per-student blocks', () => {
  const bundle = createBundle()
  const section = buildPostboardStructuredReportSection(bundle, { instanceKey: 'postboard:3:0' })

  assert.equal(section.activityId, 'postboard')
  assert.equal(section.childSessionId, 'postboard-session-1')
  assert.equal(section.instanceKey, 'postboard:3:0')
  assert.equal(section.reportStatus, 'available')
  assert.deepEqual(section.students, [
    { studentId: 'student-1', displayName: 'Ada Lovelace' },
    { studentId: 'student-2', displayName: 'Grace Hopper' },
  ])
  assert.equal(section.summaryCards?.[0]?.metrics?.find((metric) => metric.id === 'reactions')?.value, 2)
  assert.equal(section.summaryCards?.[0]?.metrics?.find((metric) => metric.id === 'flagged-posts')?.value, 1)
  assert.equal(section.scopeBlocks?.['activity-session']?.some((block) => block.id === 'postboard-post-log'), true)
  assert.equal(section.studentScopeBlocks?.['student-1']?.some((block) => block.id === 'postboard-student-posts-student-1'), true)
  assert.equal((section.payload.report as typeof bundle).sessionId, 'postboard-session-1')
})

void test('buildPostboardReportFilename sanitizes prompt text', () => {
  const bundle = createBundle()
  bundle.prompt.text = 'Debugging: loops / arrays?'

  assert.equal(buildPostboardReportFilename(bundle), 'debugging-loops-arrays.html')
})
