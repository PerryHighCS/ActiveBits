import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  buildSyncDeckReportFilename,
  buildSyncDeckSessionReportHtml,
} from './reportHtml.js'
import type { SyncDeckSessionReportManifest } from '../../../types/activity.js'

function createManifest(): SyncDeckSessionReportManifest {
  return {
    parentSessionId: 'syncdeck-42',
    generatedAt: Date.parse('2026-03-18T12:30:00Z'),
    students: [
      {
        studentId: 'studentA',
        displayName: 'Avery - Bridge Design',
      },
    ],
    activities: [
      {
        activityId: 'gallery-walk',
        activityName: 'Gallery Walk',
        childSessionId: 'CHILD:syncdeck-42:abc:gallery-walk',
        instanceKey: 'gallery-walk:4:0',
        startedAt: Date.parse('2026-03-18T11:45:00Z'),
        report: {
          activityId: 'gallery-walk',
          childSessionId: 'CHILD:syncdeck-42:abc:gallery-walk',
          instanceKey: 'gallery-walk:4:0',
          title: 'Bridge Critique Round',
          generatedAt: Date.parse('2026-03-18T12:00:00Z'),
          supportsScopes: ['activity-session', 'student-cross-activity', 'session-summary'],
          students: [
            {
              studentId: 'studentA',
              displayName: 'Avery - Bridge Design',
            },
          ],
          summaryCards: [
            {
              id: 'overview',
              title: 'Gallery Walk Overview',
              metrics: [
                { id: 'feedback-count', label: 'Feedback Entries', value: 1 },
              ],
            },
          ],
          scopeBlocks: {
            'session-summary': [
              {
                id: 'summary-block',
                type: 'rich-text',
                title: 'Snapshot',
                paragraphs: ['1 feedback entry captured in this gallery walk.'],
              },
            ],
            'activity-session': [
              {
                id: 'feedback-table',
                type: 'table',
                title: 'Feedback Log',
                columns: ['Reviewer', 'Recipient', 'Feedback', 'Style'],
                rows: [
                  {
                    id: 'row-1',
                    cells: ['Jordan', 'Avery - Bridge Design', 'Strong prototype.', 'Yellow'],
                  },
                ],
              },
            ],
          },
          studentScopeBlocks: {
            studentA: [
              {
                id: 'student-feedback',
                type: 'table',
                title: 'Feedback Received',
                columns: ['Reviewer', 'Recipient', 'Feedback', 'Style'],
                rows: [
                  {
                    id: 'student-row-1',
                    cells: ['Jordan', 'Avery - Bridge Design', 'Strong prototype.', 'Yellow'],
                  },
                ],
              },
            ],
          },
          payload: {
            feedbackCount: 1,
          },
        },
      },
      {
        activityId: 'video-sync',
        activityName: 'Video Sync',
        childSessionId: 'CHILD:syncdeck-42:def:video-sync',
        instanceKey: 'video-sync:5:0',
        startedAt: Date.parse('2026-03-18T11:55:00Z'),
        report: {
          activityId: 'video-sync',
          childSessionId: 'CHILD:syncdeck-42:def:video-sync',
          instanceKey: 'video-sync:5:0',
          title: 'Video Sync Report Unsupported',
          generatedAt: Date.parse('2026-03-18T12:00:00Z'),
          reportStatus: 'unsupported',
          supportsScopes: ['activity-session', 'student-cross-activity', 'session-summary'],
          students: [],
          summaryCards: [
            {
              id: 'video-sync-report-unsupported',
              title: 'Report Status',
              description: 'Structured reporting is not available for this activity yet.',
              metrics: [
                { id: 'status', label: 'Status', value: 'Unsupported' },
              ],
            },
          ],
          scopeBlocks: {
            'session-summary': [
              {
                id: 'video-sync-report-unsupported-summary',
                type: 'rich-text',
                title: 'Report Contribution',
                paragraphs: ['Structured reporting is not available for this activity yet.'],
              },
            ],
            'activity-session': [
              {
                id: 'video-sync-report-unsupported-activity',
                type: 'rich-text',
                title: 'Report Contribution',
                paragraphs: ['Structured reporting is not available for this activity yet.'],
              },
            ],
          },
          payload: {
            status: 'unsupported',
          },
        },
      },
    ],
  }
}

void test('buildSyncDeckReportFilename uses the parent session id', () => {
  assert.equal(buildSyncDeckReportFilename(createManifest()), 'syncdeck-syncdeck-42.html')
})

void test('buildSyncDeckSessionReportHtml renders aggregate summary, activity blocks, and per-student blocks', () => {
  const html = buildSyncDeckSessionReportHtml(createManifest())

  assert.match(html, /<!DOCTYPE html>/)
  assert.match(html, /SyncDeck Session Report/)
  assert.match(html, /Session Summary/)
  assert.match(html, /By Activity/)
  assert.match(html, /By Student/)
  assert.match(html, /Bridge Critique Round/)
  assert.match(html, /Feedback Log/)
  assert.match(html, /Feedback Received/)
  assert.match(html, /Video Sync Report Unsupported/)
  assert.match(html, /Structured reporting is not available for this activity yet\./)
  assert.match(html, /Strong prototype\./)
  assert.match(html, /Avery - Bridge Design/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /<link[^>]+href=/)
})

void test('buildSyncDeckSessionReportHtml stacks activity/student cards full-width instead of a multi-column grid', () => {
  const html = buildSyncDeckSessionReportHtml(createManifest())
  assert.match(html, /\.activity-grid, \.student-grid \{ grid-template-columns: 1fr; \}/)
})

void test('buildSyncDeckSessionReportHtml hides unsupported activities from the By Activity view and consolidates them in the summary', () => {
  const manifest = createManifest()
  const videoSyncActivity = manifest.activities[1]
  assert.ok(videoSyncActivity)
  manifest.activities.push({
    ...videoSyncActivity,
    instanceKey: 'video-sync:9:0',
    childSessionId: 'CHILD:syncdeck-42:ghi:video-sync',
    report: {
      ...videoSyncActivity.report,
      instanceKey: 'video-sync:9:0',
      childSessionId: 'CHILD:syncdeck-42:ghi:video-sync',
    },
  })

  const html = buildSyncDeckSessionReportHtml(manifest)
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://activebits.local/' })
  const { document } = dom.window
  try {
    const summaryBlockGrid = document.getElementById('summary-block-grid')
    assert.match(summaryBlockGrid?.innerHTML ?? '', /Activities without full reporting/)
    assert.match(summaryBlockGrid?.innerHTML ?? '', /Video Sync/)
    assert.match(summaryBlockGrid?.innerHTML ?? '', /2 instances/)

    const activitiesTab = document.querySelector('[data-view="activities"]')
    assert.ok(activitiesTab instanceof dom.window.HTMLElement)
    ;(activitiesTab as HTMLElement).click()

    const activityGrid = document.getElementById('activity-grid')
    assert.match(activityGrid?.innerHTML ?? '', /Bridge Critique Round/)
    assert.doesNotMatch(activityGrid?.innerHTML ?? '', /Video Sync Report Unsupported/)
  } finally {
    dom.window.close()
  }
})

void test('buildSyncDeckSessionReportHtml shows a friendly empty state in By Activity when every activity is unsupported', () => {
  const manifest = createManifest()
  manifest.activities = manifest.activities.filter((activity) => activity.activityId === 'video-sync')

  const html = buildSyncDeckSessionReportHtml(manifest)
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://activebits.local/' })
  const { document } = dom.window
  try {
    const activitiesTab = document.querySelector('[data-view="activities"]')
    assert.ok(activitiesTab instanceof dom.window.HTMLElement)
    ;(activitiesTab as HTMLElement).click()

    const activityGrid = document.getElementById('activity-grid')
    assert.match(
      activityGrid?.innerHTML ?? '',
      /None of the embedded activities in this session have added structured reporting support yet\./,
    )
    assert.doesNotMatch(activityGrid?.innerHTML ?? '', /Video Sync Report Unsupported/)
  } finally {
    dom.window.close()
  }
})
