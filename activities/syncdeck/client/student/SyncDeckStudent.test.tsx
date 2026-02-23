import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SyncDeckStudent from './SyncDeckStudent.js'

void test('SyncDeckStudent renders join guidance copy', () => {
  const html = renderToStaticMarkup(<SyncDeckStudent />)

  assert.match(html, /Join your class presentation and follow along/i)
})
