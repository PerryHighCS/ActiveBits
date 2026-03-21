import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResonanceReportView } from './ResonanceReport.js'
import type { ResonanceReport } from '../../shared/reportTypes.js'

void test('ResonanceReportView derives poll-vs-graded label from question options when reveal is null', () => {
  const report: ResonanceReport = {
    version: 1,
    sessionId: 'session-1',
    exportedAt: Date.now(),
    students: [],
    questions: [
      {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'Graded question',
          order: 0,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
      {
        question: {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Poll question',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
    ],
  }

  const html = renderToStaticMarkup(React.createElement(ResonanceReportView, { report }))

  assert.match(html, /Multiple choice[\s\S]*Graded question/)
  assert.match(html, /Poll[\s\S]*Poll question/)
})

void test('ResonanceReportView only shows results shared indicator when reveal exists', () => {
  const report: ResonanceReport = {
    version: 1,
    sessionId: 'session-2',
    exportedAt: Date.now(),
    students: [],
    questions: [
      {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'No reveal yet',
          order: 0,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
      {
        question: {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Reveal shared',
          order: 1,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: {
          questionId: 'q2',
          sharedAt: Date.now(),
          correctOptionIds: ['a'],
          sharedResponses: [],
        },
        annotations: {},
      },
    ],
  }

  const html = renderToStaticMarkup(React.createElement(ResonanceReportView, { report }))

  assert.equal((html.match(/Results shared/g) ?? []).length, 1)
})
