import JSZip from 'jszip'
import { normalizeMobCodePath } from './fileUtils'

export const ZIP_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxFiles: 200,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
} as const

const BINARY_EXTENSIONS = new Set([
  'class',
  'jar',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'zip',
  'gz',
  'tar',
])

export interface ZipImportResult {
  files: Record<string, string>
  skipped: string[]
}

interface ZipEntryMetadata {
  uncompressedSize?: number
}

interface ZipEntryWithMetadata extends JSZip.JSZipObject {
  _data?: ZipEntryMetadata
}

interface ImportAccumulator extends ZipImportResult {
  totalBytes: number
  extractedCount: number
  byteLengths: Map<string, number>
}

function shouldSkipPath(path: string): boolean {
  const parts = path.split('/')
  return (
    parts.includes('__MACOSX') ||
    parts.includes('.git') ||
    path.endsWith('.DS_Store') ||
    path.endsWith('Thumbs.db')
  )
}

function isKnownBinaryPath(path: string): boolean {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(extension)
}

export function normalizeZipEntryPath(rawPath: string): string | null {
  const normalized = normalizeMobCodePath(rawPath.replace(/^\/+/, ''))
  if (!normalized) return null
  if (normalized.length > 240 || normalized.includes('\0')) return null
  if (normalized.split('/').some((part) => part === '..' || part === '.')) return null
  if (shouldSkipPath(normalized)) return null
  return normalized
}

function createImportAccumulator(): ImportAccumulator {
  return {
    files: {},
    skipped: [],
    totalBytes: 0,
    extractedCount: 0,
    byteLengths: new Map(),
  }
}

function isZipFile(file: File): boolean {
  return file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')
}

function skipImport(accumulator: ImportAccumulator, rawPath: string): void {
  accumulator.skipped.push(rawPath)
}

function getZipEntryUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as ZipEntryWithMetadata)._data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null
}

function appendImportedBytes(accumulator: ImportAccumulator, rawPath: string, bytes: Uint8Array): void {
  const path = normalizeZipEntryPath(rawPath)
  if (!path || isKnownBinaryPath(path)) {
    skipImport(accumulator, rawPath)
    return
  }

  if (bytes.byteLength > ZIP_LIMITS.maxFileBytes) {
    skipImport(accumulator, rawPath)
    return
  }

  const previousBytes = accumulator.byteLengths.get(path) ?? 0
  const isNewPath = !accumulator.byteLengths.has(path)
  if (isNewPath && accumulator.extractedCount >= ZIP_LIMITS.maxFiles) {
    skipImport(accumulator, rawPath)
    return
  }

  const nextTotalBytes = accumulator.totalBytes - previousBytes + bytes.byteLength
  if (nextTotalBytes > ZIP_LIMITS.maxTotalBytes) {
    throw new Error('Imported files are larger than 4 MB after extraction.')
  }

  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    accumulator.files[path] = content
    accumulator.totalBytes = nextTotalBytes
    accumulator.byteLengths.set(path, bytes.byteLength)
    if (isNewPath) {
      accumulator.extractedCount += 1
    }
  } catch {
    skipImport(accumulator, rawPath)
  }
}

export async function extractZipFiles(file: File): Promise<ZipImportResult> {
  if (file.size > ZIP_LIMITS.maxZipBytes) {
    throw new Error('Zip file is larger than 10 MB.')
  }

  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const accumulator = createImportAccumulator()

  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue
    const entryName = entry.unsafeOriginalName || entry.name
    const uncompressedSize = getZipEntryUncompressedSize(entry)
    if (uncompressedSize != null && uncompressedSize > ZIP_LIMITS.maxFileBytes) {
      skipImport(accumulator, entryName)
      continue
    }
    appendImportedBytes(accumulator, entryName, await entry.async('uint8array'))
  }

  return { files: accumulator.files, skipped: accumulator.skipped }
}

export async function extractImportedFiles(inputFiles: Iterable<File>): Promise<ZipImportResult> {
  const accumulator = createImportAccumulator()
  for (const file of inputFiles) {
    if (isZipFile(file)) {
      if (file.size > ZIP_LIMITS.maxZipBytes) {
        throw new Error('Zip file is larger than 10 MB.')
      }
      const archive = await JSZip.loadAsync(await file.arrayBuffer())
      for (const entry of Object.values(archive.files)) {
        if (entry.dir) continue
        const entryName = entry.unsafeOriginalName || entry.name
        const uncompressedSize = getZipEntryUncompressedSize(entry)
        if (uncompressedSize != null && uncompressedSize > ZIP_LIMITS.maxFileBytes) {
          skipImport(accumulator, entryName)
          continue
        }
        appendImportedBytes(accumulator, entryName, await entry.async('uint8array'))
      }
      continue
    }

    if (file.size > ZIP_LIMITS.maxFileBytes) {
      skipImport(accumulator, file.webkitRelativePath || file.name)
      continue
    }

    appendImportedBytes(
      accumulator,
      file.webkitRelativePath || file.name,
      new Uint8Array(await file.arrayBuffer()),
    )
  }
  return { files: accumulator.files, skipped: accumulator.skipped }
}

export async function buildZipBlob(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'blob' })
}
