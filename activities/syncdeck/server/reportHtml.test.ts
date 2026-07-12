import assert from 'node:assert/strict'
import test from 'node:test'
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
  assert.match(html, /Strong prototype\./)
  assert.match(html, /Avery - Bridge Design/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /<link[^>]+href=/)
})
