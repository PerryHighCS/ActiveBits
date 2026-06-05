import type { ReactNode } from 'react'
import type { VirtualFileEntry } from './virtualFileExplorerTypes'

interface VirtualFileExplorerItemProps {
  entry: VirtualFileEntry
  depth: number
  activePath?: string
  expandedFolders: ReadonlySet<string>
  readOnly?: boolean
  allowRename?: boolean
  allowDelete?: boolean
  onToggleFolder: (path: string) => void
  onSelect?: (path: string) => void
  onRename?: (path: string) => void
  onDelete?: (path: string) => void
  renderItemActions?: (entry: VirtualFileEntry) => ReactNode
  getItemBadges?: (entry: VirtualFileEntry) => ReactNode
  getItemClassName?: (entry: VirtualFileEntry) => string | undefined
}

function focusTreeItemButton(button: HTMLButtonElement | null | undefined): void {
  button?.focus()
}

function getTreeItemButtons(currentTarget: HTMLButtonElement): HTMLButtonElement[] {
  const tree = currentTarget.closest('[role="tree"]')
  if (!tree) return []
  return Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
}

function focusSiblingItem(currentTarget: HTMLButtonElement, direction: -1 | 1): void {
  const buttons = getTreeItemButtons(currentTarget)
  const currentIndex = buttons.indexOf(currentTarget)
  if (currentIndex < 0) return
  focusTreeItemButton(buttons[currentIndex + direction])
}

function focusBoundaryItem(currentTarget: HTMLButtonElement, boundary: 'first' | 'last'): void {
  const buttons = getTreeItemButtons(currentTarget)
  if (buttons.length === 0) return
  focusTreeItemButton(boundary === 'first' ? buttons[0] : buttons.at(-1))
}

function focusFirstChildItem(currentTarget: HTMLButtonElement): void {
  const group = currentTarget.closest('li')?.querySelector<HTMLElement>(':scope > ul[role="group"]')
  const button = group?.querySelector<HTMLButtonElement>('[role="treeitem"]')
  focusTreeItemButton(button)
}

function focusParentItem(currentTarget: HTMLButtonElement): void {
  const parentGroup = currentTarget.closest('ul[role="group"]')
  const parentItem = parentGroup?.closest('li')?.querySelector<HTMLButtonElement>(':scope > div > [role="treeitem"]')
  focusTreeItemButton(parentItem)
}

export default function VirtualFileExplorerItem({
  entry,
  depth,
  activePath,
  expandedFolders,
  readOnly,
  allowRename,
  allowDelete,
  onToggleFolder,
  onSelect,
  onRename,
  onDelete,
  renderItemActions,
  getItemBadges,
  getItemClassName,
}: VirtualFileExplorerItemProps) {
  const isFolder = entry.kind === 'folder'
  const isExpanded = isFolder ? expandedFolders.has(entry.path) : false
  const isActive = entry.kind === 'file' && entry.path === activePath
  const canRename = !readOnly && allowRename && typeof onRename === 'function'
  const canDelete = !readOnly && allowDelete && typeof onDelete === 'function'
  const badges = getItemBadges?.(entry)
  const customClassName = getItemClassName?.(entry) ?? entry.className ?? ''
  const indent = `${depth * 0.875}rem`

  const activate = () => {
    if (isFolder) {
      onToggleFolder(entry.path)
      return
    }
    onSelect?.(entry.path)
  }

  return (
    <li role="none">
      <div
        className={[
          'group flex min-h-8 items-center gap-1 rounded px-2 text-sm',
          isActive ? 'bg-blue-100 text-blue-950' : 'text-gray-700 hover:bg-gray-100',
          customClassName,
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: `calc(0.5rem + ${indent})` }}
      >
        <button
          type="button"
          role="treeitem"
          aria-expanded={isFolder ? isExpanded : undefined}
          aria-selected={isActive || undefined}
          aria-level={depth + 1}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              focusSiblingItem(event.currentTarget, 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              focusSiblingItem(event.currentTarget, -1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              focusBoundaryItem(event.currentTarget, 'first')
            } else if (event.key === 'End') {
              event.preventDefault()
              focusBoundaryItem(event.currentTarget, 'last')
            } else if (event.key === 'ArrowRight' && isFolder && !isExpanded) {
              event.preventDefault()
              onToggleFolder(entry.path)
            } else if (event.key === 'ArrowRight' && isFolder && isExpanded) {
              event.preventDefault()
              focusFirstChildItem(event.currentTarget)
            } else if (event.key === 'ArrowLeft' && isFolder && isExpanded) {
              event.preventDefault()
              onToggleFolder(entry.path)
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault()
              focusParentItem(event.currentTarget)
            }
          }}
        >
          <span aria-hidden="true" className="w-4 shrink-0 text-center">
            {isFolder ? (isExpanded ? '▾' : '▸') : '•'}
          </span>
          <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
          {badges}
        </button>
        {renderItemActions?.(entry)}
        {!readOnly && allowRename && (
          <button
            type="button"
            className="rounded px-1 text-xs text-gray-500 opacity-0 hover:bg-gray-200 group-hover:opacity-100 focus:opacity-100"
            aria-label={`Rename ${entry.displayName}`}
            disabled={!canRename}
            aria-disabled={!canRename || undefined}
            onClick={() => onRename?.(entry.path)}
          >
            Rename
          </button>
        )}
        {!readOnly && allowDelete && (
          <button
            type="button"
            className="rounded px-1 text-xs text-red-600 opacity-0 hover:bg-red-50 group-hover:opacity-100 focus:opacity-100"
            aria-label={`Delete ${entry.displayName}`}
            disabled={!canDelete}
            aria-disabled={!canDelete || undefined}
            onClick={() => onDelete?.(entry.path)}
          >
            Delete
          </button>
        )}
      </div>
      {isFolder && isExpanded && entry.children && entry.children.length > 0 && (
        <ul role="group">
          {entry.children.map((child) => (
            <VirtualFileExplorerItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              expandedFolders={expandedFolders}
              readOnly={readOnly}
              allowRename={allowRename}
              allowDelete={allowDelete}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              renderItemActions={renderItemActions}
              getItemBadges={getItemBadges}
              getItemClassName={getItemClassName}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
