import { isSafeVirtualPath, normalizeVirtualPath } from '@src/components/common/virtualFileExplorerUtils'

const MAX_FILE_PATH_LENGTH = 240
const MAX_FILE_CONTENT_LENGTH = 1_000_000
const MAX_FILES = 250
const MAX_TOTAL_CONTENT_LENGTH = 4 * 1024 * 1024

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
  const files: Record<string, string> = {}
  let totalLength = 0
  for (const [rawPath, rawContent] of Object.entries(value)) {
    if (Object.keys(files).length >= MAX_FILES) break
    const path = normalizeMobCodePath(rawPath)
    if (!isSafeVirtualPath(path)) continue
    if (typeof rawContent !== 'string') continue
    const content = rawContent.length > MAX_FILE_CONTENT_LENGTH
      ? rawContent.slice(0, MAX_FILE_CONTENT_LENGTH)
      : rawContent
    totalLength += content.length
    if (totalLength > MAX_TOTAL_CONTENT_LENGTH) break
    files[path] = content
  }
  return files
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
