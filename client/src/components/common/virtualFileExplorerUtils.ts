import type { VirtualFileEntry } from './virtualFileExplorerTypes'

interface MutableEntry extends VirtualFileEntry {
  children: MutableEntry[]
}

const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizePathPart(part: string): string {
  return part.trim()
}

export function normalizeVirtualPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .map(normalizePathPart)
    .filter(Boolean)
    .join('/')
}

export function isSafeVirtualPath(path: string): boolean {
  const normalized = normalizeVirtualPath(path)
  if (!normalized || normalized.length > 240 || normalized.includes('\0')) return false
  return normalized.split('/').every((part) => (
    part !== '.' &&
    part !== '..' &&
    !RESERVED_PATH_SEGMENTS.has(part)
  ))
}

function sortEntries(entries: MutableEntry[]): MutableEntry[] {
  return entries
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    })
    .map((entry) => ({ ...entry, children: sortEntries(entry.children) }))
}

export function buildVirtualFileTree(files: Record<string, string>): VirtualFileEntry[] {
  const roots: MutableEntry[] = []
  const folders = new Map<string, MutableEntry>()
  const normalizedFiles: string[] = []
  const seenFiles = new Set<string>()
  const impliedFolderPaths = new Set<string>()

  function ensureFolder(path: string): MutableEntry {
    const existing = folders.get(path)
    if (existing) return existing

    const segments = path.split('/')
    const displayName = segments.at(-1) ?? path
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined
    const entry: MutableEntry = { path, kind: 'folder', displayName, parentPath, children: [] }
    folders.set(path, entry)

    if (parentPath) {
      ensureFolder(parentPath).children.push(entry)
    } else {
      roots.push(entry)
    }

    return entry
  }

  for (const rawPath of Object.keys(files)) {
    const path = normalizeVirtualPath(rawPath)
    if (!isSafeVirtualPath(path) || seenFiles.has(path)) continue
    seenFiles.add(path)
    normalizedFiles.push(path)
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      impliedFolderPaths.add(segments.slice(0, index).join('/'))
    }
  }

  for (const path of normalizedFiles) {
    if (impliedFolderPaths.has(path)) continue
    const segments = path.split('/')
    const displayName = segments.at(-1) ?? path
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined
    const fileEntry: MutableEntry = { path, kind: 'file', displayName, parentPath, children: [] }

    if (parentPath) {
      ensureFolder(parentPath).children.push(fileEntry)
    } else {
      roots.push(fileEntry)
    }
  }

  return sortEntries(roots)
}
