import { isSafeVirtualPath, normalizeVirtualPath } from '@src/components/common/virtualFileExplorerUtils'

const MAX_FILE_PATH_LENGTH = 240
const MAX_FILE_CONTENT_LENGTH = 1_000_000
const MAX_FILES = 250
const MAX_TOTAL_CONTENT_LENGTH = 4 * 1024 * 1024
const utf8Encoder = new TextEncoder()

export interface MobCodeFileSizeStats {
  perFileBytes: Record<string, number>
  totalBytes: number
}

export function getUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength
}

function truncateUtf8ToByteLimit(value: string, maxBytes: number): string {
  if (getUtf8ByteLength(value) <= maxBytes) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (getUtf8ByteLength(value.slice(0, mid)) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return value.slice(0, low)
}

export function getMobCodeFileSizeStats(files: Record<string, string>): MobCodeFileSizeStats {
  const perFileBytes: Record<string, number> = {}
  let totalBytes = 0
  for (const [path, content] of Object.entries(files)) {
    const byteLength = getUtf8ByteLength(content)
    perFileBytes[path] = byteLength
    totalBytes += byteLength
  }
  return { perFileBytes, totalBytes }
}

export function normalizeMobCodePath(path: string): string {
  return normalizeVirtualPath(path)
}

export function isValidMobCodePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const normalized = normalizeMobCodePath(path)
  return normalized === path && isSafeVirtualPath(normalized)
}

export function isValidFileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const normalized = normalizeMobCodePath(name)
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_FILE_PATH_LENGTH &&
    !normalized.includes('/') &&
    normalized === name &&
    isSafeVirtualPath(normalized)
  )
}

export function getFileExtension(path: string): string {
  const basename = path.split('/').at(-1) ?? path
  const dotIndex = basename.lastIndexOf('.')
  return dotIndex >= 0 ? basename.slice(dotIndex + 1).toLowerCase() : ''
}

export function sanitizeFilesMap(value: unknown): Record<string, string> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalizedEntries: Array<[string, string]> = []
  const impliedFolderPaths = new Set<string>()
  const seenPaths = new Set<string>()
  const files: Record<string, string> = {}
  let totalBytes = 0
  let fileCount = 0
  for (const [rawPath, rawContent] of Object.entries(value)) {
    if (fileCount >= MAX_FILES) break
    const path = normalizeMobCodePath(rawPath)
    if (!isSafeVirtualPath(path) || seenPaths.has(path)) continue
    seenPaths.add(path)
    if (typeof rawContent !== 'string') continue
    const content = truncateUtf8ToByteLimit(rawContent, MAX_FILE_CONTENT_LENGTH)
    totalBytes += getUtf8ByteLength(content)
    if (totalBytes > MAX_TOTAL_CONTENT_LENGTH) break
    normalizedEntries.push([path, content])
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      impliedFolderPaths.add(segments.slice(0, index).join('/'))
    }
    fileCount += 1
  }

  for (const [path, content] of normalizedEntries) {
    if (impliedFolderPaths.has(path)) continue
    files[path] = content
  }
  return files
}

export function clampMobCodeContentEdit(
  files: Record<string, string>,
  path: string,
  content: string,
  stats: MobCodeFileSizeStats = getMobCodeFileSizeStats(files),
): { files: Record<string, string>; content: string; limitReason: 'per-file' | 'total' | null } {
  const currentFileBytes = stats.perFileBytes[path] ?? getUtf8ByteLength(files[path] ?? '')
  const otherFilesBytes = Math.max(0, stats.totalBytes - currentFileBytes)
  const perFileClamped = truncateUtf8ToByteLimit(content, MAX_FILE_CONTENT_LENGTH)
  const maxAllowedBytes = Math.max(0, Math.min(MAX_FILE_CONTENT_LENGTH, MAX_TOTAL_CONTENT_LENGTH - otherFilesBytes))
  const nextContent = truncateUtf8ToByteLimit(perFileClamped, maxAllowedBytes)

  return {
    files: { ...files, [path]: nextContent },
    content: nextContent,
    limitReason:
      nextContent === content
        ? null
        : nextContent !== perFileClamped
          ? 'total'
          : 'per-file',
  }
}

export function wouldPathConflict(files: Record<string, string>, targetPath: string): boolean {
  const targetPrefix = `${targetPath}/`
  return Object.keys(files).some((path) => (
    path === targetPath ||
    path.startsWith(targetPrefix) ||
    targetPath.startsWith(`${path}/`)
  ))
}

export function resolveActiveFile(files: Record<string, string>, activeFile: unknown): string {
  if (typeof activeFile === 'string' && Object.hasOwn(files, activeFile)) return activeFile
  return Object.keys(files).sort((a, b) => a.localeCompare(b))[0] ?? ''
}

export function renamePathInFiles(
  files: Record<string, string>,
  oldPath: string,
  newPath: string,
): Record<string, string> {
  const remappedEntries = new Map<string, string>()
  const next: Record<string, string> = {}
  const folderPrefix = `${oldPath}/`
  for (const [path, content] of Object.entries(files)) {
    if (path === oldPath) {
      remappedEntries.set(newPath, content)
    } else if (path.startsWith(folderPrefix)) {
      remappedEntries.set(`${newPath}/${path.slice(folderPrefix.length)}`, content)
    } else {
      next[path] = content
    }
  }

  const nextPaths = Object.keys(next)
  const remappedPaths = Array.from(remappedEntries.keys())
  for (const targetPath of remappedPaths) {
    const targetPrefix = `${targetPath}/`
    if (
      Object.hasOwn(next, targetPath) ||
      nextPaths.some((path) => path.startsWith(targetPrefix) || targetPath.startsWith(`${path}/`)) ||
      remappedPaths.some((path) => path !== targetPath && (targetPath.startsWith(`${path}/`) || path.startsWith(targetPrefix)))
    ) {
      return files
    }
  }

  for (const [path, content] of remappedEntries) {
    next[path] = content
  }

  return next
}

export function renameActiveFilePath(activeFile: string, oldPath: string, newPath: string): string {
  if (activeFile === oldPath) return newPath
  const folderPrefix = `${oldPath}/`
  if (!activeFile.startsWith(folderPrefix)) return activeFile
  return `${newPath}/${activeFile.slice(folderPrefix.length)}`
}

export function deletePathFromFiles(files: Record<string, string>, targetPath: string): Record<string, string> {
  const next: Record<string, string> = {}
  const folderPrefix = `${targetPath}/`
  for (const [path, content] of Object.entries(files)) {
    if (path === targetPath || path.startsWith(folderPrefix)) continue
    next[path] = content
  }
  return next
}
