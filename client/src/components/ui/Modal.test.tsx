import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import Modal from './Modal'

test('Modal does not render when closed', () => {
  const html = renderToStaticMarkup(
    <Modal open={false} onClose={() => {}}>
      Hidden content
    </Modal>,
  )

  assert.equal(html, '')
})

test('Modal renders title, close button, and children when open', () => {
  const html = renderToStaticMarkup(
    <Modal open onClose={() => {}} title="Details">
      Body text
    </Modal>,
  )

  assert.match(html, /Details/)
  assert.match(html, /Body text/)
  assert.match(html, /aria-label="Close"/)
  assert.match(html, /fixed inset-0/)
})
