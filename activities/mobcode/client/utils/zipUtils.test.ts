import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { extractZipFiles, normalizeZipEntryPath, ZIP_LIMITS } from './zipUtils'

async function makeZipFile(entries: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'test.zip', { type: 'application/zip' })
}

void test('normalizes zip paths and rejects traversal/artifacts', () => {
  assert.equal(normalizeZipEntryPath('/src/Main.java'), 'src/Main.java')
  assert.equal(normalizeZipEntryPath('../Main.java'), null)
  assert.equal(normalizeZipEntryPath('__MACOSX/file'), null)
  assert.equal(normalizeZipEntryPath('src/.DS_Store'), null)
})

void test('extractZipFiles skips binary/artifact entries and extracts text', async () => {
  const file = await makeZipFile({
    'Main.java': 'class Main {}',
    'image.png': new Uint8Array([1, 2, 3]),
    '.git/config': 'x',
  })
  const result = await extractZipFiles(file)
  assert.deepEqual(result.files, { 'Main.java': 'class Main {}' })
  assert.ok(result.skipped.includes('image.png'))
})

void test('extractZipFiles rejects large zip file inputs before extraction', async () => {
  const file = new File([new Uint8Array(ZIP_LIMITS.maxZipBytes + 1)], 'large.zip')
  await assert.rejects(() => extractZipFiles(file), /larger than 10 MB/)
})
