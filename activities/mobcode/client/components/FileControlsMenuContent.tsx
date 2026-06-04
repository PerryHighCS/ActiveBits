import { useRef, useState } from 'react'
import { buildZipBlob, extractImportedFiles, extractZipFiles } from '../utils/zipUtils'

interface FileControlsMenuContentProps {
  files: Record<string, string>
  onUploadFiles: (files: Record<string, string>) => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onMessageChange?: (message: string) => void
}

export default function FileControlsMenuContent({
  files,
  onUploadFiles,
  onCreateFile,
  onCreateFolder,
  onMessageChange,
}: FileControlsMenuContentProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState('')
  const hasFiles = Object.keys(files).length > 0

  const updateMessage = (nextMessage: string) => {
    setMessage(nextMessage)
    onMessageChange?.(nextMessage)
  }

  const importFiles = async (selectedFiles: File[]) => {
    const result = await extractImportedFiles(selectedFiles)
    onUploadFiles(result.files)
    updateMessage(result.skipped.length > 0 ? `${result.skipped.length} files skipped` : '')
  }

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
      <button type="button" className={menuButtonClass} onClick={onCreateFile}>
        New File
      </button>
      <button type="button" className={menuButtonClass} onClick={onCreateFolder}>
        New Folder
      </button>
      <button
        type="button"
        className={menuButtonClass}
        onClick={() => uploadFilesInputRef.current?.click()}
      >
        Upload Files
      </button>
      <button
        type="button"
        className={menuButtonClass}
        onClick={() => fileInputRef.current?.click()}
      >
        Upload Zip
      </button>
      <input
        ref={uploadFilesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const selectedFiles = Array.from(event.target.files ?? [])
          event.currentTarget.value = ''
          if (selectedFiles.length === 0) return
          void importFiles(selectedFiles).catch((error) => {
            updateMessage(error instanceof Error ? error.message : 'Could not import files')
          })
        }}
      />
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
              updateMessage(result.skipped.length > 0 ? `${result.skipped.length} files skipped` : '')
            })
            .catch((error) => {
              updateMessage(error instanceof Error ? error.message : 'Could not import zip')
            })
        }}
      />
      <button
        type="button"
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
