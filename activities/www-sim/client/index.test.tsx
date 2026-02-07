import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import wwwSimActivity from './index'

test('www-sim activity client module exports manager and student components', () => {
  assert.equal(typeof wwwSimActivity.ManagerComponent, 'function')
  assert.equal(typeof wwwSimActivity.StudentComponent, 'function')
})

test('www-sim footer content includes curriculum attribution', () => {
  const footerContent = renderToStaticMarkup(<>{wwwSimActivity.footerContent}</>)
  assert.match(footerContent, /Code\.org/)
  assert.match(footerContent, /CC BY-NC-SA 4\.0/)
})
