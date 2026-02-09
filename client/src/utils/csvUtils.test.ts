import test from 'node:test'
import assert from 'node:assert/strict'
import { arrayToCsv, downloadCsv, escapeCsvCell } from './csvUtils'

void test('escapeCsvCell escapes RFC 4180 special characters', () => {
  assert.equal(escapeCsvCell('plain'), 'plain')
  assert.equal(escapeCsvCell('hello,world'), '"hello,world"')
  assert.equal(escapeCsvCell('a"b'), '"a""b"')
  assert.equal(escapeCsvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(escapeCsvCell(null), '')
})

void test('arrayToCsv serializes rows with escaping', () => {
  const csv = arrayToCsv([
    ['name', 'note'],
    ['Ada', 'contains,comma'],
    ['Lin', 'says "hi"'],
  ])

  assert.equal(csv, 'name,note\nAda,"contains,comma"\nLin,"says ""hi"""')
})

void test('downloadCsv creates and clicks a hidden download link', () => {
  const originalDocument = globalThis.document
  const originalUrl = globalThis.URL

  let appendedNode: HTMLAnchorElement | null = null
  let removedNode: HTMLAnchorElement | null = null
  let clicked = false
  let createdBlobUrl: string | null = null
  let revokedBlobUrl: string | null = null
  const linkAttributes: Record<string, string> = {}
  const linkStyle: { visibility?: string } = {}

  const link = {
    style: linkStyle,
    setAttribute(name: string, value: string) {
      linkAttributes[name] = value
    },
    click() {
      clicked = true
    },
  } as unknown as HTMLAnchorElement

  const documentMock = {
    createElement(tag: string) {
      assert.equal(tag, 'a')
      return link
    },
    body: {
      appendChild(node: Node) {
        appendedNode = node as HTMLAnchorElement
      },
      removeChild(node: Node) {
        removedNode = node as HTMLAnchorElement
      },
    },
  } as unknown as Document

  const urlMock = {
    createObjectURL() {
      createdBlobUrl = 'blob:test-url'
      return createdBlobUrl
    },
    revokeObjectURL(url: string) {
      revokedBlobUrl = url
    },
  } as unknown as typeof URL

  globalThis.document = documentMock
  globalThis.URL = urlMock

  try {
    downloadCsv('a,b', 'report')
  } finally {
    globalThis.document = originalDocument
    globalThis.URL = originalUrl
  }

  assert.equal(linkAttributes.href, 'blob:test-url')
  assert.equal(linkAttributes.download, 'report.csv')
  assert.equal(linkStyle.visibility, 'hidden')
  assert.equal(appendedNode, link)
  assert.equal(removedNode, link)
  assert.equal(clicked, true)
  assert.equal(createdBlobUrl, 'blob:test-url')
  assert.equal(revokedBlobUrl, 'blob:test-url')
})
