import type { ReactNode } from 'react'

export interface VirtualFileEntry {
  path: string
  kind: 'file' | 'folder'
  displayName: string
  parentPath?: string
  children?: VirtualFileEntry[]
  className?: string
}

export interface VirtualFileExplorerProps {
  files: Record<string, string>
  activePath?: string
  readOnly?: boolean
  allowCreate?: boolean
  allowRename?: boolean
  allowDelete?: boolean
  onSelect?: (path: string) => void
  onCreateFile?: (parentPath?: string) => void
  onCreateFolder?: (parentPath?: string) => void
  onRename?: (path: string) => void
  onDelete?: (path: string) => void
  renderItemActions?: (entry: VirtualFileEntry) => ReactNode
  getItemBadges?: (entry: VirtualFileEntry) => ReactNode
  getItemClassName?: (entry: VirtualFileEntry) => string | undefined
}
