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

export async function extractZipFiles(file: File): Promise<ZipImportResult> {
  if (file.size > ZIP_LIMITS.maxZipBytes) {
    throw new Error('Zip file is larger than 10 MB.')
  }

  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const files: Record<string, string> = {}
  const skipped: string[] = []
  let totalBytes = 0
  let extractedCount = 0

  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue
    const path = normalizeZipEntryPath(entry.name)
    if (!path || isKnownBinaryPath(path)) {
      skipped.push(entry.name)
      continue
    }
    if (extractedCount >= ZIP_LIMITS.maxFiles) {
      skipped.push(entry.name)
      continue
    }

    const bytes = await entry.async('uint8array')
    if (bytes.byteLength > ZIP_LIMITS.maxFileBytes) {
      skipped.push(path)
      continue
    }
    totalBytes += bytes.byteLength
    if (totalBytes > ZIP_LIMITS.maxTotalBytes) {
      throw new Error('Zip contents are larger than 4 MB after extraction.')
    }

    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      files[path] = content
      extractedCount += 1
    } catch {
      skipped.push(path)
    }
  }

  return { files, skipped }
}

export async function buildZipBlob(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'blob' })
}
