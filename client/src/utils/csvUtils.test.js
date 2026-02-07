import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeCsvCell, arrayToCsv, downloadCsv } from './csvUtils.ts'

test('escapeCsvCell escapes RFC 4180 special characters', () => {
  assert.equal(escapeCsvCell('plain'), 'plain')
  assert.equal(escapeCsvCell('hello,world'), '"hello,world"')
  assert.equal(escapeCsvCell('a"b'), '"a""b"')
  assert.equal(escapeCsvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(escapeCsvCell(null), '')
})

test('arrayToCsv serializes rows with escaping', () => {
  const csv = arrayToCsv([
    ['name', 'note'],
    ['Ada', 'contains,comma'],
    ['Lin', 'says "hi"'],
  ])

  assert.equal(csv, 'name,note\nAda,"contains,comma"\nLin,"says ""hi"""')
})

test('downloadCsv creates and clicks a hidden download link', () => {
  const originalDocument = globalThis.document
  const originalUrl = globalThis.URL

  let appendedNode = null
  let removedNode = null
  let clicked = false
  let createdBlobUrl = null
  let revokedBlobUrl = null

  const link = {
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    click() {
      clicked = true
    },
  }

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a')
      return link
    },
    body: {
      appendChild(node) {
        appendedNode = node
      },
      removeChild(node) {
        removedNode = node
      },
    },
  }

  globalThis.URL = {
    createObjectURL() {
      createdBlobUrl = 'blob:test-url'
      return createdBlobUrl
    },
    revokeObjectURL(url) {
      revokedBlobUrl = url
    },
  }

  try {
    downloadCsv('a,b', 'report')
  } finally {
    globalThis.document = originalDocument
    globalThis.URL = originalUrl
  }

  assert.equal(link.attributes.href, 'blob:test-url')
  assert.equal(link.attributes.download, 'report.csv')
  assert.equal(link.style.visibility, 'hidden')
  assert.equal(appendedNode, link)
  assert.equal(removedNode, link)
  assert.equal(clicked, true)
  assert.equal(createdBlobUrl, 'blob:test-url')
  assert.equal(revokedBlobUrl, 'blob:test-url')
})
