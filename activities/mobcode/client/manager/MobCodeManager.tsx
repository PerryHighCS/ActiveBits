import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import type { VirtualFileEntry } from '@src/components/common/virtualFileExplorerTypes'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type { MobCodeSelectionRange, MobCodeStatePayload, MobCodeThemeId } from '../../shared/types'
import CodeEditor from '../components/CodeEditor'
import FileNameModal from '../components/FileNameModal'
import FileControlsMenuContent from '../components/FileControlsMenuContent'
import SettingsMenu from '../components/SettingsMenu'
import { MOB_CODE_INSTRUCTOR_STORAGE_PREFIX, MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import {
  deletePathFromFiles,
  renameActiveFilePath,
  renamePathInFiles,
  resolveActiveFile,
  sanitizeFilesMap,
} from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { extractImportedFiles } from '../utils/zipUtils'
import {
  applyActiveFileChange,
  applyContentChange,
  createEditorPresencePayload,
  createLiveContentSyncPlan,
  createStateSnapshot,
  isStatePayload,
  parseMobCodeMessage,
} from './managerUtils'
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
type DurableMobCodeMessageType =
  | typeof MOB_CODE_MESSAGE_TYPES.STATE_SYNC
  | typeof MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED

const LIVE_CONTENT_SYNC_INTERVAL_MS = 120
const LIVE_PRESENCE_SYNC_INTERVAL_MS = 60

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
  const [fileImportMessage, setFileImportMessage] = useState('')
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef<MobCodeStatePayload>(createStateSnapshot({}, ''))
  const lastLiveSyncAtRef = useRef(0)
  const pendingContentUpdateRef = useRef<{ path: string; content: string; selections: MobCodeSelectionRange[] } | null>(null)
  const presenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPresenceRef = useRef<{ path: string; selections: MobCodeSelectionRange[] } | null>(null)
  const lastPresenceSyncAtRef = useRef(0)
  const latestEditorSelectionsRef = useRef<MobCodeSelectionRange[]>([])

  useEffect(() => {
    latestStateRef.current = createStateSnapshot(files, activeFile)
  }, [files, activeFile])

  useEffect(() => {
    if (!sessionId) return
    void fetch(`/api/mobcode/${sessionId}/session`)
      .then((res) => (res.ok ? res.json() as Promise<SessionResponse> : null))
      .then((session) => {
        if (!session) return
        const nextFiles = sanitizeFilesMap(session.data?.groups?.default?.files)
        const nextActiveFile = resolveActiveFile(nextFiles, session.data?.groups?.default?.activeFile)
        latestStateRef.current = createStateSnapshot(nextFiles, nextActiveFile)
        setFiles(nextFiles)
        setActiveFile(nextActiveFile)
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
  }, [sessionId])

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId, role: 'manager' })
    return `${protocol}//${window.location.host}/ws/mobcode?${params.toString()}`
  }, [sessionId])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
    onOpen: (_event, ws) => {
      if (!instructorPasscode) return
      ws.send(JSON.stringify({
        type: MOB_CODE_MESSAGE_TYPES.MANAGER_AUTH,
        sessionId,
        payload: { instructorPasscode },
      }))
    },
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
    return () => {
      if (wsDebounceRef.current) {
        clearTimeout(wsDebounceRef.current)
        wsDebounceRef.current = null
      }
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current)
        persistDebounceRef.current = null
      }
      if (presenceDebounceRef.current) {
        clearTimeout(presenceDebounceRef.current)
        presenceDebounceRef.current = null
      }
      disconnect()
    }
  }, [sessionId, connect, disconnect])

  const persistState = useCallback(
    async (payload: MobCodeStatePayload, messageType: DurableMobCodeMessageType = MOB_CODE_MESSAGE_TYPES.STATE_SYNC) => {
      if (!sessionId || !instructorPasscode) return
      try {
        const response = await fetch(`/api/mobcode/${sessionId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, instructorPasscode, messageType }),
        })
        if (!response.ok) {
          throw new Error(`MobCode state persist failed with status ${response.status}`)
        }
      } catch (error) {
        console.error('Failed to persist MobCode state:', error)
      }
    },
    [sessionId, instructorPasscode],
  )

  const sendWsMessage = useCallback(
    (type: string, payload: unknown): boolean => {
      if (!sessionId || socketRef.current?.readyState !== 1) return false
      socketRef.current.send(JSON.stringify({ type, sessionId, payload }))
      return true
    },
    [sessionId, socketRef],
  )

  const flushPendingPresenceSync = useCallback(() => {
    const pendingPresence = pendingPresenceRef.current
    if (!pendingPresence) return
    const sent = sendWsMessage(
      MOB_CODE_MESSAGE_TYPES.EDITOR_PRESENCE_UPDATE,
      createEditorPresencePayload(pendingPresence.path, pendingPresence.selections),
    )
    if (!sent) return
    pendingPresenceRef.current = null
    lastPresenceSyncAtRef.current = Date.now()
  }, [sendWsMessage])

  const flushPendingContentSync = useCallback(() => {
    const pendingUpdate = pendingContentUpdateRef.current
    if (!pendingUpdate) return
    const sent = sendWsMessage(MOB_CODE_MESSAGE_TYPES.FILE_CONTENT_UPDATE, {
      path: pendingUpdate.path,
      content: pendingUpdate.content,
    })
    if (!sent) return
    pendingPresenceRef.current = {
      path: pendingUpdate.path,
      selections: pendingUpdate.selections,
    }
    flushPendingPresenceSync()
    pendingContentUpdateRef.current = null
    lastLiveSyncAtRef.current = Date.now()
  }, [flushPendingPresenceSync, sendWsMessage])

  const scheduleContentSync = useCallback(
    (path: string, content: string, selections: MobCodeSelectionRange[]) => {
      pendingContentUpdateRef.current = { path, content, selections }

      const syncPlan = createLiveContentSyncPlan(Date.now(), lastLiveSyncAtRef.current, LIVE_CONTENT_SYNC_INTERVAL_MS)
      if (syncPlan.sendImmediately) {
        if (wsDebounceRef.current) {
          clearTimeout(wsDebounceRef.current)
          wsDebounceRef.current = null
        }
        flushPendingContentSync()
      } else if (wsDebounceRef.current == null) {
        wsDebounceRef.current = setTimeout(() => {
          wsDebounceRef.current = null
          flushPendingContentSync()
        }, syncPlan.delayMs)
      }

      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current)
      persistDebounceRef.current = setTimeout(() => {
        void persistState(latestStateRef.current)
      }, 5000)
    },
    [flushPendingContentSync, persistState],
  )

  const schedulePresenceSync = useCallback(
    (path: string, selections: MobCodeSelectionRange[]) => {
      pendingPresenceRef.current = { path, selections }

      const syncPlan = createLiveContentSyncPlan(Date.now(), lastPresenceSyncAtRef.current, LIVE_PRESENCE_SYNC_INTERVAL_MS)
      if (syncPlan.sendImmediately) {
        if (presenceDebounceRef.current) {
          clearTimeout(presenceDebounceRef.current)
          presenceDebounceRef.current = null
        }
        flushPendingPresenceSync()
      } else if (presenceDebounceRef.current == null) {
        presenceDebounceRef.current = setTimeout(() => {
          presenceDebounceRef.current = null
          flushPendingPresenceSync()
        }, syncPlan.delayMs)
      }
    },
    [flushPendingPresenceSync],
  )

  const clearPendingSync = useCallback(() => {
    if (wsDebounceRef.current) {
      clearTimeout(wsDebounceRef.current)
      wsDebounceRef.current = null
    }
    pendingContentUpdateRef.current = null
    if (presenceDebounceRef.current) {
      clearTimeout(presenceDebounceRef.current)
      presenceDebounceRef.current = null
    }
    pendingPresenceRef.current = null
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current)
      persistDebounceRef.current = null
    }
  }, [])

  const applyFiles = useCallback(
    (
      nextFiles: Record<string, string>,
      nextActiveFile: string,
      messageType: DurableMobCodeMessageType = MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED,
    ) => {
      clearPendingSync()
      latestStateRef.current = createStateSnapshot(nextFiles, nextActiveFile)
      setFiles(nextFiles)
      setActiveFile(nextActiveFile)
      void persistState({ files: nextFiles, activeFile: nextActiveFile }, messageType)
    },
    [clearPendingSync, persistState],
  )

  const importFilesIntoWorkspace = useCallback(
    (importedFiles: Record<string, string>, skippedCount = 0) => {
      const nextFiles = sanitizeFilesMap({
        ...latestStateRef.current.files,
        ...importedFiles,
      })
      const importedPaths = Object.keys(importedFiles).sort((a, b) => a.localeCompare(b))
      const focusPath = importedPaths.find((path) => Object.hasOwn(nextFiles, path)) ?? latestStateRef.current.activeFile
      const nextActiveFile = resolveActiveFile(nextFiles, focusPath)
      setFileImportMessage(skippedCount > 0 ? `${skippedCount} files skipped` : '')
      applyFiles(nextFiles, nextActiveFile, MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED)
    },
    [applyFiles],
  )

  const handleDroppedFiles = useCallback(
    async (droppedFiles: File[]) => {
      try {
        const result = await extractImportedFiles(droppedFiles)
        importFilesIntoWorkspace(result.files, result.skipped.length)
      } catch (error) {
        setFileImportMessage(error instanceof Error ? error.message : 'Could not import dropped files')
      }
    },
    [importFilesIntoWorkspace],
  )

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const activeContent = activeFile ? files[activeFile] ?? '' : ''
  const editorThemeClassName = `mobcode-editor-theme-${theme}`

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
      applyFiles(nextFiles, resolveActiveFile(nextFiles, renameActiveFilePath(activeFile, renameTarget, path)))
    }
    setModalMode(null)
    setRenameTarget('')
  }

  return (
    <div className="mobcode-shell">
      <SessionHeader
        activityName="Mob Code"
        sessionId={sessionId}
        includeBottomMargin={false}
        actionMenuLabel="Code Files"
        actionMenuContent={(
          <FileControlsMenuContent
            files={files}
            onUploadFiles={(uploadedFiles) => {
              importFilesIntoWorkspace(uploadedFiles)
            }}
            onCreateFile={() => setModalMode('create-file')}
            onCreateFolder={() => setModalMode('create-folder')}
            onMessageChange={setFileImportMessage}
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
            dropPrompt="Drop files or zip archives here to import"
            onSelect={(path) => {
              latestStateRef.current = applyActiveFileChange(latestStateRef.current, path)
              setActiveFile(path)
              sendWsMessage(MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED, { activeFile: path })
              schedulePresenceSync(path, [{ anchor: 0, head: 0 }])
              void persistState(latestStateRef.current)
            }}
            onCreateFile={() => setModalMode('create-file')}
            onCreateFolder={() => setModalMode('create-folder')}
            onDropFiles={handleDroppedFiles}
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
          {fileImportMessage && (
            <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {fileImportMessage}
            </div>
          )}
        </aside>
        <main className={`mobcode-editor-pane ${editorThemeClassName}`}>
          {activeFile ? (
            <CodeEditor
              value={activeContent}
              filename={activeFile}
              theme={theme}
              onUpdate={(viewUpdate) => {
                if (!activeFile || (!viewUpdate.docChanged && !viewUpdate.selectionSet)) return
                const selections = viewUpdate.state.selection.ranges.map((range) => ({
                  anchor: range.anchor,
                  head: range.head,
                }))
                latestEditorSelectionsRef.current = selections
                if (viewUpdate.docChanged) {
                  const content = viewUpdate.state.doc.toString()
                  setFiles((current) => {
                    const nextState = applyContentChange(
                      createStateSnapshot(current, latestStateRef.current.activeFile),
                      activeFile,
                      content,
                    )
                    latestStateRef.current = nextState
                    return nextState.files
                  })
                  scheduleContentSync(activeFile, content, selections)
                } else {
                  schedulePresenceSync(activeFile, selections)
                }
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
