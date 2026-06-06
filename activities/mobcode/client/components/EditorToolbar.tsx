import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MobCodeThemeId } from '../../shared/types'
import SettingsMenu from './SettingsMenu'
import { buildZipBlob, extractZipFiles } from '../utils/zipUtils'

interface EditorToolbarProps {
  files: Record<string, string>
  readOnly?: boolean
  theme: MobCodeThemeId
  centerControls?: ReactNode
  onThemeChange: (theme: MobCodeThemeId) => void
  onUploadFiles?: (files: Record<string, string>) => void
  onCreateFile?: () => void
  onCreateFolder?: () => void
}

export default function EditorToolbar({
  files,
  readOnly = false,
  theme,
  centerControls,
  onThemeChange,
  onUploadFiles,
  onCreateFile,
  onCreateFolder,
}: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState('')

  const handleDownload = async () => {
    const blob = await buildZipBlob(files)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mobcode-files.zip'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mobcode-editor-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <>
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
                    onUploadFiles?.(result.files)
                    setMessage(result.skipped.length > 0 ? `${result.skipped.length} files skipped` : '')
                  })
                  .catch((error) => {
                    setMessage(error instanceof Error ? error.message : 'Could not import zip')
                  })
              }}
            />
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onCreateFile}
            >
              New File
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onCreateFolder}
            >
              New Folder
            </button>
          </>
        )}
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          onClick={() => void handleDownload()}
          disabled={Object.keys(files).length === 0}
        >
          Download Zip
        </button>
        {message && <span className="text-sm text-amber-700">{message}</span>}
      </div>
      {centerControls != null && <div className="mobcode-editor-toolbar-center">{centerControls}</div>}
      <SettingsMenu theme={theme} onThemeChange={onThemeChange} />
    </div>
  )
}
