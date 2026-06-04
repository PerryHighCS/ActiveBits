import { useRef, useState } from 'react'
import { buildZipBlob, extractZipFiles } from '../utils/zipUtils'

interface FileControlsMenuContentProps {
  files: Record<string, string>
  onUploadFiles: (files: Record<string, string>) => void
  onCreateFile: () => void
  onCreateFolder: () => void
}

export default function FileControlsMenuContent({
  files,
  onUploadFiles,
  onCreateFile,
  onCreateFolder,
}: FileControlsMenuContentProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState('')
  const hasFiles = Object.keys(files).length > 0

  const handleDownload = async () => {
    const blob = await buildZipBlob(files)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mobcode-files.zip'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const menuButtonClass = 'block w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'

  return (
    <div className="space-y-1">
      <button type="button" role="menuitem" className={menuButtonClass} onClick={onCreateFile}>
        New File
      </button>
      <button type="button" role="menuitem" className={menuButtonClass} onClick={onCreateFolder}>
        New Folder
      </button>
      <button
        type="button"
        role="menuitem"
        className={menuButtonClass}
        onClick={() => fileInputRef.current?.click()}
      >
        Upload Zip
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          void extractZipFiles(file)
            .then((result) => {
              onUploadFiles(result.files)
              setMessage(result.skipped.length > 0 ? `${result.skipped.length} files skipped` : '')
            })
            .catch((error) => {
              setMessage(error instanceof Error ? error.message : 'Could not import zip')
            })
        }}
      />
      <button
        type="button"
        role="menuitem"
        className={`${menuButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={!hasFiles}
        onClick={() => void handleDownload()}
      >
        Download Zip
      </button>
      {message && <p className="px-3 py-1 text-sm text-amber-700">{message}</p>}
    </div>
  )
}
