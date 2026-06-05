import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import type { VirtualFileEntry } from '@src/components/common/virtualFileExplorerTypes'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type {
  MobCodeMessageType,
  MobCodeRunnerId,
  MobCodeSelectionRange,
  MobCodeStatePayload,
  MobCodeThemeId,
} from '../../shared/types'
import { isMobCodeRunnerId } from '../../shared/types'
import CodeEditor from '../components/CodeEditor'
import FileNameModal from '../components/FileNameModal'
import FileControlsMenuContent from '../components/FileControlsMenuContent'
import SettingsMenu from '../components/SettingsMenu'
import { MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import {
  clampMobCodeContentEdit,
  deletePathFromFiles,
  getMobCodeFileSizeStats,
  getUtf8ByteLength,
  renameActiveFilePath,
  renamePathInFiles,
  resolveActiveFile,
  sanitizeFilesMap,
  wouldPathConflict,
} from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { extractImportedFiles } from '../utils/zipUtils'
import {
  DEFAULT_MOB_CODE_RUNNER_ID,
  MOB_CODE_RUNNERS,
  openMobCodeRunnerPopup,
} from '../runner/runnerUtils'
import {
  applyActiveFileChange,
  applyContentChange,
  createEditorPresencePayload,
  flushPendingMobCodeCleanupWork,
  createLiveContentSyncPlan,
  createStateSnapshot,
  isStatePayload,
  parseMobCodeMessage,
  sendMobCodeWsMessage,
} from './managerUtils'
import { resolveMobCodeInstructorPasscode } from './passcodeUtils'
import '../styles.css'

interface SessionResponse {
  data?: {
    groups?: {
      default?: {
        files?: unknown
        activeFile?: unknown
      }
    }
    runnerId?: unknown
  }
}

type ModalMode = 'create-file' | 'create-folder' | 'rename' | null
type DurableMobCodeMessageType =
  | typeof MOB_CODE_MESSAGE_TYPES.STATE_SYNC
  | typeof MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED

const LIVE_CONTENT_SYNC_INTERVAL_MS = 250
const LIVE_PRESENCE_SYNC_INTERVAL_MS = 60
const PERSIST_STATE_INTERVAL_MS = 5000

export default function MobCodeManager() {
  const { sessionId } = useParams()
  const encodedSessionId = sessionId ? encodeURIComponent(sessionId) : ''
  const location = useLocation()
  const instructorPasscode = resolveMobCodeInstructorPasscode({
    sessionId,
    locationState: location.state,
  })
  const canEdit = instructorPasscode.length > 0
  const [files, setFiles] = useState<Record<string, string>>({})
  const [activeFile, setActiveFile] = useState('')
  const [theme, setTheme] = useState<MobCodeThemeId>(() => getThemeFromCookie())
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [renameTarget, setRenameTarget] = useState('')
  const [modalErrorMessage, setModalErrorMessage] = useState('')
  const [fileImportMessage, setFileImportMessage] = useState('')
  const [editorLimitMessage, setEditorLimitMessage] = useState('')
  const [runnerId, setRunnerId] = useState<MobCodeRunnerId>(DEFAULT_MOB_CODE_RUNNER_ID)
  const [runnerMessage, setRunnerMessage] = useState('')
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef<MobCodeStatePayload>(createStateSnapshot({}, ''))
  const latestFileSizeStatsRef = useRef(getMobCodeFileSizeStats({}))
  const lastLiveSyncAtRef = useRef(0)
  const lastPersistSyncAtRef = useRef(0)
  const pendingContentUpdateRef = useRef<{ path: string; content: string; selections: MobCodeSelectionRange[] } | null>(null)
  const presenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPresenceRef = useRef<{ path: string; selections: MobCodeSelectionRange[] } | null>(null)
  const lastPresenceSyncAtRef = useRef(0)

  useEffect(() => {
    latestStateRef.current = createStateSnapshot(files, activeFile)
  }, [files, activeFile])

  const replaceFilesState = useCallback((nextFiles: Record<string, string>) => {
    latestFileSizeStatsRef.current = getMobCodeFileSizeStats(nextFiles)
    setFiles(nextFiles)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    void fetch(`/api/mobcode/${encodedSessionId}/session`)
      .then((res) => (res.ok ? res.json() as Promise<SessionResponse> : null))
      .then((session) => {
        if (!session) return
        const nextFiles = sanitizeFilesMap(session.data?.groups?.default?.files)
        const nextActiveFile = resolveActiveFile(nextFiles, session.data?.groups?.default?.activeFile)
        latestStateRef.current = createStateSnapshot(nextFiles, nextActiveFile)
        replaceFilesState(nextFiles)
        setActiveFile(nextActiveFile)
        if (isMobCodeRunnerId(session.data?.runnerId)) {
          setRunnerId(session.data.runnerId)
        }
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
  }, [encodedSessionId, replaceFilesState, sessionId])

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
        replaceFilesState(msg.payload.files)
        setActiveFile(msg.payload.activeFile)
      }
    },
  })

  const persistState = useCallback(
    async (payload: MobCodeStatePayload, messageType: DurableMobCodeMessageType = MOB_CODE_MESSAGE_TYPES.STATE_SYNC) => {
      if (!sessionId || !instructorPasscode) return
      try {
        const response = await fetch(`/api/mobcode/${encodedSessionId}/state`, {
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
    [encodedSessionId, sessionId, instructorPasscode],
  )

  const sendWsMessage = useCallback(
    (type: MobCodeMessageType, payload: unknown): boolean => {
      if (!sessionId || !instructorPasscode) return false
      return sendMobCodeWsMessage(socketRef.current, { type, sessionId, payload })
    },
    [instructorPasscode, sessionId, socketRef],
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

  const flushPendingPersistSync = useCallback(() => {
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current)
      persistDebounceRef.current = null
    }
    lastPersistSyncAtRef.current = Date.now()
    void persistState(latestStateRef.current)
  }, [persistState])

  const schedulePersistSync = useCallback(() => {
    const syncPlan = createLiveContentSyncPlan(Date.now(), lastPersistSyncAtRef.current, PERSIST_STATE_INTERVAL_MS)
    if (syncPlan.sendImmediately) {
      flushPendingPersistSync()
      return
    }
    if (persistDebounceRef.current == null) {
      persistDebounceRef.current = setTimeout(() => {
        flushPendingPersistSync()
      }, syncPlan.delayMs)
    }
  }, [flushPendingPersistSync])

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

      schedulePersistSync()
    },
    [flushPendingContentSync, schedulePersistSync],
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

  useEffect(() => {
    if (!sessionId) return undefined
    connect()
    return () => {
      const hasPendingContent = pendingContentUpdateRef.current != null
      const hasPendingPresence = pendingPresenceRef.current != null
      const hasPendingPersist = persistDebounceRef.current != null
      if (wsDebounceRef.current) {
        clearTimeout(wsDebounceRef.current)
        wsDebounceRef.current = null
      }
      if (presenceDebounceRef.current) {
        clearTimeout(presenceDebounceRef.current)
        presenceDebounceRef.current = null
      }
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current)
        persistDebounceRef.current = null
      }
      flushPendingMobCodeCleanupWork({
        hasPendingContent,
        hasPendingPresence,
        hasPendingPersist,
        flushContent: flushPendingContentSync,
        flushPresence: flushPendingPresenceSync,
        flushPersist: flushPendingPersistSync,
      })
      disconnect()
    }
  }, [
    sessionId,
    connect,
    disconnect,
    flushPendingContentSync,
    flushPendingPersistSync,
    flushPendingPresenceSync,
  ])

  const applyFiles = useCallback(
    (
      nextFiles: Record<string, string>,
      nextActiveFile: string,
      messageType: DurableMobCodeMessageType = MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED,
    ) => {
      clearPendingSync()
      latestStateRef.current = createStateSnapshot(nextFiles, nextActiveFile)
      replaceFilesState(nextFiles)
      setActiveFile(nextActiveFile)
      void persistState({ files: nextFiles, activeFile: nextActiveFile }, messageType)
    },
    [clearPendingSync, persistState, replaceFilesState],
  )

  const importFilesIntoWorkspace = useCallback(
    (importedFiles: Record<string, string>, skippedCount = 0) => {
      if (!canEdit) return
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
    [applyFiles, canEdit],
  )

  const handleDroppedFiles = useCallback(
    async (droppedFiles: File[]) => {
      if (!canEdit) return
      try {
        const result = await extractImportedFiles(droppedFiles)
        importFilesIntoWorkspace(result.files, result.skipped.length)
      } catch (error) {
        setFileImportMessage(error instanceof Error ? error.message : 'Could not import dropped files')
      }
    },
    [canEdit, importFilesIntoWorkspace],
  )

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const handleRunCode = () => {
    const result = openMobCodeRunnerPopup({
      files: latestStateRef.current.files,
      activeFile: latestStateRef.current.activeFile,
      sessionId,
      runnerId,
    })
    setRunnerMessage(
      result.opened
        ? ''
        : result.reason === 'missing-entry'
          ? 'Add or select a Python file before running it.'
          : result.reason === 'popup-blocked'
            ? 'The runner popup was blocked. Allow popups for this site and try again.'
            : 'That runner is not available yet.',
    )
  }

  const activeContent = activeFile ? files[activeFile] ?? '' : ''
  const editorThemeClassName = `mobcode-editor-theme-${theme}`

  const submitModal = (path: string) => {
    if (modalMode === 'create-file') {
      if (wouldPathConflict(files, path)) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      const nextFiles = { ...files, [path]: '' }
      applyFiles(nextFiles, path)
    } else if (modalMode === 'create-folder') {
      if (wouldPathConflict(files, path)) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      const keepPath = `${path}/.keep`
      const nextFiles = { ...files, [keepPath]: '' }
      applyFiles(nextFiles, keepPath)
    } else if (modalMode === 'rename' && renameTarget) {
      const nextFiles = renamePathInFiles(files, renameTarget, path)
      if (nextFiles === files) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      applyFiles(nextFiles, resolveActiveFile(nextFiles, renameActiveFilePath(activeFile, renameTarget, path)))
    }
    setModalErrorMessage('')
    setModalMode(null)
    setRenameTarget('')
  }

  return (
    <div className="mobcode-shell">
      <SessionHeader
        activityName="Mob Code"
        sessionId={sessionId}
        includeBottomMargin={false}
        actionMenuLabel={canEdit ? 'Code Files' : undefined}
        actionMenuRole={canEdit ? 'menu' : undefined}
        actionMenuContent={canEdit ? (
          <FileControlsMenuContent
            files={files}
            onUploadFiles={(uploadedFiles) => {
              importFilesIntoWorkspace(uploadedFiles)
            }}
            onCreateFile={() => setModalMode('create-file')}
            onCreateFolder={() => setModalMode('create-folder')}
            onMessageChange={setFileImportMessage}
          />
        ) : undefined}
        headerActions={(
          <div className="mobcode-header-actions">
            <label className="mobcode-runner-picker">
              <span className="sr-only">Runner implementation</span>
              <select
                aria-label="Runner implementation"
                value={runnerId}
                onChange={(event) => setRunnerId(event.target.value as MobCodeRunnerId)}
              >
                {MOB_CODE_RUNNERS.map((runner) => (
                  <option key={runner.id} value={runner.id}>
                    {runner.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="mobcode-runner-button"
              onClick={handleRunCode}
              disabled={Object.keys(files).length === 0}
              title={MOB_CODE_RUNNERS.find((runner) => runner.id === runnerId)?.description}
            >
              Run
            </button>
            <SettingsMenu theme={theme} onThemeChange={handleThemeChange} label="Theme" />
          </div>
        )}
      />
      {!instructorPasscode && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Instructor edit credentials are not available in this tab. Rejoin from the create-session flow to persist changes.
        </div>
      )}
      {runnerMessage && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {runnerMessage}
        </div>
      )}
      <div className="mobcode-workspace">
        <aside className="mobcode-sidebar">
          <VirtualFileExplorer
            files={files}
            activePath={activeFile}
            allowCreate={canEdit}
            allowRename={canEdit}
            allowDelete={canEdit}
            dropPrompt="Drop files or zip archives here to import"
            onSelect={(path) => {
              setActiveFile(path)
              if (!canEdit) return
              latestStateRef.current = applyActiveFileChange(latestStateRef.current, path)
              sendWsMessage(MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED, { activeFile: path })
              schedulePresenceSync(path, [{ anchor: 0, head: 0 }])
              void persistState(latestStateRef.current)
            }}
            onCreateFile={canEdit ? () => setModalMode('create-file') : undefined}
            onCreateFolder={canEdit ? () => setModalMode('create-folder') : undefined}
            onDropFiles={canEdit ? handleDroppedFiles : undefined}
            onRename={(path) => {
              if (!canEdit) return
              setRenameTarget(path)
              setModalMode('rename')
            }}
            onDelete={(path) => {
              if (!canEdit) return
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
              readOnly={!canEdit}
              onUpdate={(viewUpdate) => {
                if (!canEdit) return
                if (!activeFile || (!viewUpdate.docChanged && !viewUpdate.selectionSet)) return
                const selections = viewUpdate.state.selection.ranges.map((range) => ({
                  anchor: range.anchor,
                  head: range.head,
                }))
                if (viewUpdate.docChanged) {
                  const content = viewUpdate.state.doc.toString()
                  const clampedEdit = clampMobCodeContentEdit(
                    latestStateRef.current.files,
                    activeFile,
                    content,
                    latestFileSizeStatsRef.current,
                  )
                  setEditorLimitMessage(
                    clampedEdit.limitReason === 'per-file'
                      ? 'This file reached the 1 MB MobCode limit and was truncated.'
                      : clampedEdit.limitReason === 'total'
                        ? 'The MobCode workspace reached the 4 MiB limit. This edit was truncated.'
                        : '',
                  )
                  const nextState = applyContentChange(
                    createStateSnapshot(clampedEdit.files, latestStateRef.current.activeFile),
                    activeFile,
                    clampedEdit.content,
                  )
                  const nextContentBytes = getUtf8ByteLength(clampedEdit.content)
                  latestFileSizeStatsRef.current = {
                    perFileBytes: {
                      ...latestFileSizeStatsRef.current.perFileBytes,
                      [activeFile]: nextContentBytes,
                    },
                    totalBytes: Math.max(
                      0,
                      latestFileSizeStatsRef.current.totalBytes
                        - (latestFileSizeStatsRef.current.perFileBytes[activeFile] ?? 0)
                        + nextContentBytes,
                    ),
                  }
                  latestStateRef.current = nextState
                  setFiles(nextState.files)
                  scheduleContentSync(activeFile, clampedEdit.content, selections)
                } else {
                  schedulePresenceSync(activeFile, selections)
                }
              }}
            />
          ) : (
            <div className="mobcode-empty">Create or upload files to start coding.</div>
          )}
          {editorLimitMessage && (
            <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {editorLimitMessage}
            </div>
          )}
        </main>
      </div>
      <FileNameModal
        open={modalMode !== null}
        title={modalMode === 'rename' ? 'Rename Path' : modalMode === 'create-folder' ? 'New Folder' : 'New File'}
        initialValue={modalMode === 'rename' ? renameTarget : ''}
        submitLabel={modalMode === 'rename' ? 'Rename' : 'Create'}
        errorMessage={modalErrorMessage}
        onClose={() => {
          setModalErrorMessage('')
          setModalMode(null)
          setRenameTarget('')
        }}
        onSubmit={submitModal}
      />
    </div>
  )
}
