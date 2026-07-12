import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResonanceReportFilename, buildResonanceReportHtml } from './reportRenderer.js'
import type { ResonanceReport } from '../shared/reportTypes.js'

void test('buildResonanceReportFilename sanitizes session IDs to safe slug characters', () => {
  const filename = buildResonanceReportFilename('CHILD:abc/def?x=1";\\')

  assert.ok(
    /^resonance-report-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.html$/.test(filename),
    `filename must use only safe slug characters, got: ${filename}`,
  )
  assert.ok(!filename.includes(':'), 'filename must not contain colon')
})

void test('buildResonanceReportFilename falls back when sanitized session ID is empty', () => {
  const filename = buildResonanceReportFilename(':::')
  assert.ok(filename.startsWith('resonance-report-session-'), `unexpected fallback filename: ${filename}`)
})

void test('buildResonanceReportHtml labels MCQ questions from question definition even when reveal is missing', () => {
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
          text: 'Graded MCQ',
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
          text: 'Poll MCQ',
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

  const html = buildResonanceReportHtml(report)
  assert.match(html, /<span class="type-label">Multiple choice<\/span>\s*<div class="question-stem">[\s\S]*Graded MCQ/)
  assert.match(html, /<span class="type-label">Poll<\/span>\s*<div class="question-stem">[\s\S]*Poll MCQ/)
})

void test('buildResonanceReportHtml renders shared MCQ responses using option text', () => {
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
          text: 'Favorite planet?',
          order: 0,
          options: [
            { id: 'opt_earth', text: 'Earth' },
            { id: 'opt_mars', text: 'Mars' },
          ],
        },
        responses: [],
        reveal: {
          questionId: 'q1',
          sharedAt: Date.now(),
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: { type: 'multiple-choice', selectedOptionIds: ['opt_mars'] },
              sharedAt: Date.now(),
              instructorEmoji: null,
              reactions: {},
            },
          ],
        },
        annotations: {},
      },
    ],
  }

  const html = buildResonanceReportHtml(report)
  assert.match(html, /<li><div class="resonance-markdown/)
  assert.match(html, /Mars/)
  assert.doesNotMatch(html, /<li>opt_mars<\/li>/)
})

void test('buildResonanceReportHtml renders Markdown in authored stems and MCQ choices', () => {
  const report: ResonanceReport = {
    version: 1,
    sessionId: 'session-3',
    exportedAt: Date.now(),
    students: [],
    questions: [
      {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: [
            'What does this print?',
            '',
            '```python',
            'print([1, 2][0])',
            '```',
            '',
            '| index | value |',
            '| ---: | ---: |',
            '| 0 | 1 |',
          ].join('\n'),
          order: 0,
          options: [
            { id: 'a', text: '`1`', isCorrect: true },
            { id: 'b', text: '<SCRIPT>alert("x")</SCRIPT>' },
            { id: 'c', text: '![Chart](javascript:alert(1))' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
    ],
  }

  const html = buildResonanceReportHtml(report)
  assert.match(html, /<pre/)
  assert.match(html, /<table/)
  assert.match(html, /<div class="max-w-full overflow-x-auto">/)
  assert.match(html, /\.report-markdown \.overflow-x-auto \{ overflow-x: auto; \}/)
  assert.match(html, /<code/)
  assert.doesNotMatch(html, /<script\b/i)
  assert.doesNotMatch(html, /javascript:alert/)
})
