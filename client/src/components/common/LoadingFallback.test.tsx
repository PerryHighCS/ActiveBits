import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import LoadingFallback from './LoadingFallback'

test('LoadingFallback renders default message', () => {
  const html = renderToStaticMarkup(<LoadingFallback />)

  assert.match(html, /Loading activity\.\.\./)
  assert.match(html, /text-center/)
})

test('LoadingFallback renders custom message', () => {
  const html = renderToStaticMarkup(<LoadingFallback message="Loading roster..." />)

  assert.match(html, /Loading roster\.\.\./)
})
