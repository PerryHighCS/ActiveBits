import { isSafeVirtualPath, normalizeVirtualPath } from '@src/components/common/virtualFileExplorerUtils'

const MAX_FILE_PATH_LENGTH = 240
const MAX_FILE_CONTENT_LENGTH = 1_000_000

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
  for (const [rawPath, rawContent] of Object.entries(value)) {
    const path = normalizeMobCodePath(rawPath)
    if (!isSafeVirtualPath(path)) continue
    if (typeof rawContent !== 'string') continue
    files[path] = rawContent.length > MAX_FILE_CONTENT_LENGTH
      ? rawContent.slice(0, MAX_FILE_CONTENT_LENGTH)
      : rawContent
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
  const next: Record<string, string> = {}
  const folderPrefix = `${oldPath}/`
  for (const [path, content] of Object.entries(files)) {
    if (path === oldPath) {
      next[newPath] = content
    } else if (path.startsWith(folderPrefix)) {
      next[`${newPath}/${path.slice(folderPrefix.length)}`] = content
    } else {
      next[path] = content
    }
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
