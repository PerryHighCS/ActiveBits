import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResonanceReportFilename } from './reportRenderer.js'

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
