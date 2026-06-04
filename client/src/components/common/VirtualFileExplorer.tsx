import { useMemo, useState } from 'react'
import VirtualFileExplorerItem from './VirtualFileExplorerItem'
import type { VirtualFileExplorerProps } from './virtualFileExplorerTypes'
import { buildVirtualFileTree } from './virtualFileExplorerUtils'

export default function VirtualFileExplorer({
  files,
  activePath,
  readOnly = false,
  allowCreate = false,
  allowRename = false,
  allowDelete = false,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  renderItemActions,
  getItemBadges,
  getItemClassName,
}: VirtualFileExplorerProps) {
  const tree = useMemo(() => buildVirtualFileTree(files), [files])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())

  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-800">Files</h2>
        {!readOnly && allowCreate && (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => onCreateFile?.()}
            >
              File
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => onCreateFolder?.()}
            >
              Folder
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tree.length === 0 ? (
          <p className="px-2 py-3 text-sm text-gray-500">No files yet</p>
        ) : (
          <ul role="tree" aria-label="Files" className="space-y-0.5">
            {tree.map((entry) => (
              <VirtualFileExplorerItem
                key={entry.path}
                entry={entry}
                depth={0}
                activePath={activePath}
                expandedFolders={expandedFolders}
                readOnly={readOnly}
                allowRename={allowRename}
                allowDelete={allowDelete}
                onToggleFolder={toggleFolder}
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
      </div>
    </div>
  )
}
