import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { extractImportedFiles, extractZipFiles, normalizeZipEntryPath, ZIP_LIMITS } from './zipUtils'

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
  assert.equal(normalizeZipEntryPath(`src/${'a'.repeat(241)}.java`), null)
  assert.equal(normalizeZipEntryPath('bad\0name.java'), null)
  assert.equal(normalizeZipEntryPath('__MACOSX/file'), null)
  assert.equal(normalizeZipEntryPath('src/.DS_Store'), null)
})

void test('extractZipFiles skips binary/artifact entries and extracts text', async () => {
  const file = await makeZipFile({
    'Main.java': 'class Main {}',
    'image.png': new Uint8Array([1, 2, 3]),
    '.git/config': 'x',
    'src/Large.txt': 'x'.repeat(ZIP_LIMITS.maxFileBytes + 1),
  })
  const result = await extractZipFiles(file)
  assert.deepEqual(result.files, { 'Main.java': 'class Main {}' })
  assert.ok(result.skipped.includes('image.png'))
  assert.ok(result.skipped.includes('src/Large.txt'))
})

void test('extractZipFiles rejects large zip file inputs before extraction', async () => {
  const file = new File([new Uint8Array(ZIP_LIMITS.maxZipBytes + 1)], 'large.zip')
  await assert.rejects(() => extractZipFiles(file), /larger than 10 MB/)
})

void test('extractImportedFiles combines text files and zip archives', async () => {
  const zipFile = await makeZipFile({
    'src/Helper.java': 'class Helper {}',
  })
  const textFile = new File(['class Main {}'], 'Main.java', { type: 'text/plain' })
  const binaryFile = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })

  const result = await extractImportedFiles([textFile, zipFile, binaryFile])

  assert.deepEqual(result.files, {
    'Main.java': 'class Main {}',
    'src/Helper.java': 'class Helper {}',
  })
  assert.deepEqual(result.skipped, ['image.png'])
})

void test('extractImportedFiles skips oversized plain files before reading them into memory', async () => {
  let arrayBufferCalls = 0
  const oversizedFile = {
    name: 'Huge.java',
    size: ZIP_LIMITS.maxFileBytes + 1,
    type: 'text/plain',
    webkitRelativePath: '',
    arrayBuffer: async () => {
      arrayBufferCalls += 1
      return new ArrayBuffer(0)
    },
  } as unknown as File

  const result = await extractImportedFiles([oversizedFile])

  assert.deepEqual(result.files, {})
  assert.deepEqual(result.skipped, ['Huge.java'])
  assert.equal(arrayBufferCalls, 0)
})
