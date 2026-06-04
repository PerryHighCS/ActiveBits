import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import type { VirtualFileEntry } from '@src/components/common/virtualFileExplorerTypes'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type { MobCodeStatePayload, MobCodeThemeId } from '../../shared/types'
import CodeEditor from '../components/CodeEditor'
import { resolveEditorTheme } from '../components/CodeEditor'
import FileNameModal from '../components/FileNameModal'
import FileControlsMenuContent from '../components/FileControlsMenuContent'
import SettingsMenu from '../components/SettingsMenu'
import { MOB_CODE_INSTRUCTOR_STORAGE_PREFIX, MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import {
  deletePathFromFiles,
  renamePathInFiles,
  resolveActiveFile,
  sanitizeFilesMap,
} from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { isStatePayload, parseMobCodeMessage } from './managerUtils'
import '../styles.css'

interface SessionResponse {
  data?: {
    groups?: {
      default?: {
        files?: unknown
        activeFile?: unknown
      }
    }
  }
}

type ModalMode = 'create-file' | 'create-folder' | 'rename' | null

function readInstructorPasscode(sessionId: string | undefined, locationState: unknown): string {
  const state = locationState != null && typeof locationState === 'object'
    ? (locationState as Record<string, unknown>)
    : {}
  const fromState = state.instructorPasscode
  if (typeof fromState === 'string' && fromState.length > 0) return fromState
  if (!sessionId || typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem(`${MOB_CODE_INSTRUCTOR_STORAGE_PREFIX}${sessionId}`) ?? ''
}

export default function MobCodeManager() {
  const { sessionId } = useParams()
  const location = useLocation()
  const instructorPasscode = readInstructorPasscode(sessionId, location.state)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [activeFile, setActiveFile] = useState('')
  const [theme, setTheme] = useState<MobCodeThemeId>(() => getThemeFromCookie())
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [renameTarget, setRenameTarget] = useState('')
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef<MobCodeStatePayload>({ files: {}, activeFile: '' })

  useEffect(() => {
    latestStateRef.current = { files, activeFile }
  }, [files, activeFile])

  useEffect(() => {
    if (!sessionId) return
    void fetch(`/api/mobcode/${sessionId}/session`)
      .then((res) => (res.ok ? res.json() as Promise<SessionResponse> : null))
      .then((session) => {
        if (!session) return
        const nextFiles = sanitizeFilesMap(session.data?.groups?.default?.files)
        setFiles(nextFiles)
        setActiveFile(resolveActiveFile(nextFiles, session.data?.groups?.default?.activeFile))
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
  }, [sessionId])

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId, role: 'manager', instructorPasscode })
    return `${protocol}//${window.location.host}/ws/mobcode?${params.toString()}`
  }, [sessionId, instructorPasscode])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
    onMessage: (event) => {
      const msg = parseMobCodeMessage(event.data)
      if (!msg || !isStatePayload(msg.payload)) return
      if (msg.type === MOB_CODE_MESSAGE_TYPES.STATE_SYNC || msg.type === MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED) {
        setFiles(msg.payload.files)
        setActiveFile(msg.payload.activeFile)
      }
    },
  })

  useEffect(() => {
    if (!sessionId) return undefined
    connect()
    return () => disconnect()
  }, [sessionId, connect, disconnect])

  const persistState = useCallback(
    async (payload: MobCodeStatePayload, messageType: string = MOB_CODE_MESSAGE_TYPES.STATE_SYNC) => {
      if (!sessionId || !instructorPasscode) return
      await fetch(`/api/mobcode/${sessionId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, instructorPasscode, messageType }),
      })
    },
    [sessionId, instructorPasscode],
  )

  const sendWsMessage = useCallback(
    (type: string, payload: unknown) => {
      if (!sessionId || socketRef.current?.readyState !== 1) return
      socketRef.current.send(JSON.stringify({ type, sessionId, payload }))
    },
    [sessionId, socketRef],
  )

  const scheduleContentSync = useCallback(
    (path: string, content: string) => {
      if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current)
      wsDebounceRef.current = setTimeout(() => {
        sendWsMessage(MOB_CODE_MESSAGE_TYPES.FILE_CONTENT_UPDATE, { path, content })
      }, 500)

      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current)
      persistDebounceRef.current = setTimeout(() => {
        void persistState(latestStateRef.current)
      }, 5000)
    },
    [persistState, sendWsMessage],
  )

  const applyFiles = useCallback(
    (nextFiles: Record<string, string>, nextActiveFile: string, messageType: string = MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED) => {
      setFiles(nextFiles)
      setActiveFile(nextActiveFile)
      void persistState({ files: nextFiles, activeFile: nextActiveFile }, messageType)
    },
    [persistState],
  )

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const activeContent = activeFile ? files[activeFile] ?? '' : ''
  const editorThemeClassName = typeof resolveEditorTheme(theme) === 'string'
    ? `mobcode-editor-theme-${theme}`
    : `mobcode-editor-theme-${theme}`

  const submitModal = (path: string) => {
    if (modalMode === 'create-file') {
      const nextFiles = { ...files, [path]: '' }
      applyFiles(nextFiles, path)
    } else if (modalMode === 'create-folder') {
      const keepPath = `${path}/.keep`
      const nextFiles = { ...files, [keepPath]: '' }
      applyFiles(nextFiles, keepPath)
    } else if (modalMode === 'rename' && renameTarget) {
      const nextFiles = renamePathInFiles(files, renameTarget, path)
      applyFiles(nextFiles, resolveActiveFile(nextFiles, activeFile === renameTarget ? path : activeFile))
    }
    setModalMode(null)
    setRenameTarget('')
  }

  return (
    <div className="mobcode-shell">
      <SessionHeader
        activityName="Mob Code"
        sessionId={sessionId}
        actionMenuLabel="Code Files"
        actionMenuContent={(
          <FileControlsMenuContent
            files={files}
            onUploadFiles={(uploadedFiles) => {
              const nextActive = resolveActiveFile(uploadedFiles, activeFile)
              applyFiles(uploadedFiles, nextActive, MOB_CODE_MESSAGE_TYPES.STATE_SYNC)
            }}
            onCreateFile={() => setModalMode('create-file')}
            onCreateFolder={() => setModalMode('create-folder')}
          />
        )}
        headerActions={<SettingsMenu theme={theme} onThemeChange={handleThemeChange} label="Theme" />}
      />
      {!instructorPasscode && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Instructor edit credentials are not available in this tab. Rejoin from the create-session flow to persist changes.
        </div>
      )}
      <div className="mobcode-workspace">
        <aside className="mobcode-sidebar">
          <VirtualFileExplorer
            files={files}
            activePath={activeFile}
            allowCreate
            allowRename
            allowDelete
            onSelect={(path) => {
              setActiveFile(path)
              sendWsMessage(MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED, { activeFile: path })
              void persistState({ files, activeFile: path })
            }}
            onCreateFile={() => setModalMode('create-file')}
            onCreateFolder={() => setModalMode('create-folder')}
            onRename={(path) => {
              setRenameTarget(path)
              setModalMode('rename')
            }}
            onDelete={(path) => {
              const nextFiles = deletePathFromFiles(files, path)
              applyFiles(nextFiles, resolveActiveFile(nextFiles, activeFile))
            }}
            getItemBadges={(entry: VirtualFileEntry) => entry.path.endsWith('/.keep') ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">keep</span>
            ) : null}
          />
        </aside>
        <main className={`mobcode-editor-pane ${editorThemeClassName}`}>
          {activeFile ? (
            <CodeEditor
              value={activeContent}
              filename={activeFile}
              theme={theme}
              onChange={(content) => {
                setFiles((current) => ({ ...current, [activeFile]: content }))
                scheduleContentSync(activeFile, content)
              }}
            />
          ) : (
            <div className="mobcode-empty">Create or upload files to start coding.</div>
          )}
        </main>
      </div>
      <FileNameModal
        open={modalMode !== null}
        title={modalMode === 'rename' ? 'Rename Path' : modalMode === 'create-folder' ? 'New Folder' : 'New File'}
        initialValue={modalMode === 'rename' ? renameTarget : ''}
        submitLabel={modalMode === 'rename' ? 'Rename' : 'Create'}
        onClose={() => {
          setModalMode(null)
          setRenameTarget('')
        }}
        onSubmit={submitModal}
      />
    </div>
  )
}
