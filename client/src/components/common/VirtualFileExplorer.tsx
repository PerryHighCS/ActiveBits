import { useMemo, useRef, useState } from 'react'
import VirtualFileExplorerItem from './VirtualFileExplorerItem'
import type { VirtualFileExplorerProps } from './virtualFileExplorerTypes'
import { buildVirtualFileTree } from './virtualFileExplorerUtils'

function FilePlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 1.75h4.25L12.5 5v8.25A1.75 1.75 0 0 1 10.75 15h-5.5A1.75 1.75 0 0 1 3.5 13.25v-9.75A1.75 1.75 0 0 1 5.25 1.75Z" />
      <path d="M9 1.75V5h3.25" />
      <path d="M8 7.25v4.5" />
      <path d="M5.75 9.5h4.5" />
    </svg>
  )
}

function FolderPlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.75 4.25A1.75 1.75 0 0 1 3.5 2.5h2.1c.46 0 .89.18 1.21.5l.69.69c.33.33.78.51 1.24.51h3.76A1.75 1.75 0 0 1 14.25 6v6.5a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 12.5v-8.25Z" />
      <path d="M8 6.75v4.5" />
      <path d="M5.75 9h4.5" />
    </svg>
  )
}

export default function VirtualFileExplorer({
  files,
  activePath,
  readOnly = false,
  allowCreate = false,
  allowRename = false,
  allowDelete = false,
  dropPrompt = 'Drop files here to import',
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onDropFiles,
  renderItemActions,
  getItemBadges,
  getItemClassName,
}: VirtualFileExplorerProps) {
  const tree = useMemo(() => buildVirtualFileTree(files), [files])
  const filePaths = useMemo(() => new Set(Object.keys(files)), [files])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const canDropFiles = !readOnly && typeof onDropFiles === 'function'
  const effectiveExpandedFolders = useMemo(() => {
    if (!activePath || !filePaths.has(activePath)) {
      return expandedFolders
    }

    const segments = activePath.split('/')
    if (segments.length <= 1) {
      return expandedFolders
    }

    const next = new Set(expandedFolders)
    for (let index = 1; index < segments.length; index += 1) {
      next.add(segments.slice(0, index).join('/'))
    }
    return next
  }, [activePath, expandedFolders, filePaths])

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

  const resetDragState = () => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }

  return (
    <div
      className={[
        'relative flex h-full min-h-0 flex-col border-r border-gray-200 bg-white',
        canDropFiles && isDragActive ? 'ring-2 ring-inset ring-blue-400' : '',
      ].filter(Boolean).join(' ')}
      onDragEnter={(event) => {
        if (!canDropFiles || !event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        dragDepthRef.current += 1
        setIsDragActive(true)
      }}
      onDragOver={(event) => {
        if (!canDropFiles || !event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!canDropFiles || !event.dataTransfer?.types.includes('Files')) return
        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) {
          setIsDragActive(false)
        }
      }}
      onDrop={(event) => {
        if (!canDropFiles) return
        event.preventDefault()
        const droppedFiles = Array.from(event.dataTransfer?.files ?? [])
        resetDragState()
        if (droppedFiles.length === 0) return
        void onDropFiles?.(droppedFiles)
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-800">Files</h2>
        {!readOnly && allowCreate && (
          <div className="flex gap-1">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              aria-label="Add file"
              title="Add file"
              onClick={() => onCreateFile?.()}
            >
              <FilePlusIcon />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              aria-label="Add folder"
              title="Add folder"
              onClick={() => onCreateFolder?.()}
            >
              <FolderPlusIcon />
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
                expandedFolders={effectiveExpandedFolders}
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
      {canDropFiles && isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-blue-50/90 px-6 text-center text-sm font-medium text-blue-700">
          {dropPrompt}
        </div>
      )}
    </div>
  )
}
