import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MCQInput, { getMcqInputControlType, toggleMcqSelection } from './MCQInput.js'

void test('MCQInput renders checkbox controls and multi-select submit copy', () => {
  const html = renderToStaticMarkup(
    React.createElement(MCQInput, {
      options: [
        { id: 'a', text: 'Option A' },
        { id: 'b', text: 'Option B' },
      ],
      selectionMode: 'multiple',
      onSubmit: () => undefined,
    }),
  )

  assert.match(html, /type="checkbox"/)
  assert.match(html, /Submit answers/)
})

void test('toggleMcqSelection adds and removes options for multi-select questions', () => {
  assert.deepEqual(toggleMcqSelection('multiple', [], 'a'), ['a'])
  assert.deepEqual(toggleMcqSelection('multiple', ['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleMcqSelection('multiple', ['a', 'b'], 'a'), ['b'])
})

void test('toggleMcqSelection and control type stay single-select outside multi-select mode', () => {
  assert.equal(getMcqInputControlType('single'), 'radio')
  assert.equal(getMcqInputControlType('multiple'), 'checkbox')
  assert.deepEqual(toggleMcqSelection('single', ['a'], 'b'), ['b'])
})
