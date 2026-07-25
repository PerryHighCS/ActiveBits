import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import SessionHeader from '@src/components/common/SessionHeader'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import type { VirtualFileEntry } from '@src/components/common/virtualFileExplorerTypes'
import { useEmbeddedManagerPasscodeExchange } from '@src/hooks/useEmbeddedManagerPasscodeExchange'
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
import EditorToolbar from '../components/EditorToolbar'
import FileNameModal from '../components/FileNameModal'
import FileControlsMenuContent from '../components/FileControlsMenuContent'
import RunnerControls from '../components/RunnerControls'
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
  shouldApplyRemoteStateMessage,
} from './managerUtils'
import { resolveMobCodeInstructorPasscode } from './passcodeUtils'
import '../styles.css'

interface MobCodeWorkspaceSnapshot {
  files: Record<string, string>
  activeFile: string
}

interface MobCodeManagerStudentWorkspace {
  participantId: string
  displayName: string
  files: Record<string, string>
  activeFile: string
}

interface MobCodeManagerSessionSnapshot {
  instructorWorkspace: MobCodeWorkspaceSnapshot
  runnerId: MobCodeRunnerId | null
  tryItEnabled: boolean
  shareChangesEnabled: boolean
  starterVersion: MobCodeWorkspaceSnapshot | null
  students: MobCodeManagerStudentWorkspace[]
  sharedExample: { sourceParticipantId: string; workspace: MobCodeWorkspaceSnapshot } | null
}

type ModalMode = 'create-file' | 'create-folder' | 'rename' | null
type MobCodeManagerWorkspaceSelection =
  | { kind: 'instructor' }
  | { kind: 'student'; participantId: string }
  | { kind: 'shared' }
type DurableMobCodeMessageType =
  | typeof MOB_CODE_MESSAGE_TYPES.STATE_SYNC
  | typeof MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED

const LIVE_CONTENT_SYNC_INTERVAL_MS = 250
const LIVE_PRESENCE_SYNC_INTERVAL_MS = 60
const PERSIST_STATE_INTERVAL_MS = 5000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseWorkspaceSnapshot(value: unknown): MobCodeWorkspaceSnapshot | null {
  if (!isRecord(value)) return null
  const files = sanitizeFilesMap(value.files)
  return { files, activeFile: resolveActiveFile(files, value.activeFile) }
}

export function parseMobCodeManagerSessionSnapshot(value: unknown): MobCodeManagerSessionSnapshot | null {
  if (!isRecord(value) || !isRecord(value.data)) return null
  const data = value.data
  const groups = isRecord(data.groups) ? data.groups : null
  const instructorWorkspace = parseWorkspaceSnapshot(groups?.default)
  if (!instructorWorkspace) return null
  const studentCode = isRecord(data.studentCode) ? data.studentCode : {}
  const students = Array.isArray(studentCode.students)
    ? studentCode.students.flatMap((student) => {
      if (!isRecord(student) || typeof student.participantId !== 'string' || typeof student.displayName !== 'string') return []
      const workspace = parseWorkspaceSnapshot(student)
      return workspace ? [{ participantId: student.participantId, displayName: student.displayName, ...workspace }] : []
    })
    : []
  const sharedSourceId = isRecord(studentCode.sharedExample) && typeof studentCode.sharedExample.sourceParticipantId === 'string'
    ? studentCode.sharedExample.sourceParticipantId
    : null
  const sharedWorkspace = isRecord(studentCode.sharedExample) ? parseWorkspaceSnapshot(studentCode.sharedExample.workspace) : null
  return {
    instructorWorkspace,
    runnerId: isMobCodeRunnerId(data.runnerId) ? data.runnerId : null,
    tryItEnabled: studentCode.tryItEnabled === true,
    shareChangesEnabled: studentCode.shareChangesEnabled === true,
    starterVersion: parseWorkspaceSnapshot(studentCode.starterVersion),
    students,
    sharedExample: sharedSourceId && sharedWorkspace ? { sourceParticipantId: sharedSourceId, workspace: sharedWorkspace } : null,
  }
}

export function createMobCodeManagerAuthMessage(
  sessionId: string | undefined,
  instructorPasscode: string,
): string | null {
  if (!sessionId || !instructorPasscode) {
    return null
  }

  return JSON.stringify({
    type: MOB_CODE_MESSAGE_TYPES.MANAGER_AUTH,
    sessionId,
    payload: { instructorPasscode },
  })
}

export function resolveMobCodeManagerAccessBanner(params: {
  instructorPasscode: string
  isResolving: boolean
}): 'loading' | 'missing' | null {
  if (params.instructorPasscode) {
    return null
  }
  return params.isResolving ? 'loading' : 'missing'
}

export function resolveOpenMobCodeManagerAuthMessage(params: {
  sessionId: string | undefined
  instructorPasscode: string
  readyState: number | undefined
}): string | null {
  return params.readyState === 1
    ? createMobCodeManagerAuthMessage(params.sessionId, params.instructorPasscode)
    : null
}

interface MobCodeManagerProps {
  /** Session and opaque edit credential used by a server-backed solo workspace. */
  sessionIdOverride?: string
  soloEditToken?: string
  soloMode?: boolean
}

export function resolveMobCodeWorkspaceAccess(params: {
  isSolo: boolean
  instructorPasscode: string
}): boolean {
  return params.isSolo || params.instructorPasscode.length > 0
}

export default function MobCodeManager({ sessionIdOverride, soloEditToken, soloMode = false }: MobCodeManagerProps = {}) {
  const { sessionId: routeSessionId } = useParams()
  const sessionId = sessionIdOverride ?? routeSessionId
  const isSolo = soloMode || (typeof soloEditToken === 'string' && soloEditToken.length > 0)
  const encodedSessionId = sessionId ? encodeURIComponent(sessionId) : ''
  const location = useLocation()
  const fallbackInstructorPasscode = useMemo(() => resolveMobCodeInstructorPasscode({
    sessionId,
    locationState: location.state,
  }), [location.state, sessionId])
  const embeddedManagerPasscodeExchange = useEmbeddedManagerPasscodeExchange({
    sessionId,
    search: location.search,
  })
  const [instructorPasscode, setInstructorPasscode] = useState(fallbackInstructorPasscode)
  const canEdit = resolveMobCodeWorkspaceAccess({ isSolo, instructorPasscode })
  const instructorAccessBanner = resolveMobCodeManagerAccessBanner({
    instructorPasscode: isSolo ? 'solo' : instructorPasscode,
    isResolving: embeddedManagerPasscodeExchange.isResolving,
  })
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
  const [tryItEnabled, setTryItEnabled] = useState(false)
  const [shareChangesEnabled, setShareChangesEnabled] = useState(true)
  const [studentCodeMessage, setStudentCodeMessage] = useState('')
  const [studentWorkspaces, setStudentWorkspaces] = useState<MobCodeManagerStudentWorkspace[]>([])
  const [workspaceSelection, setWorkspaceSelection] = useState<MobCodeManagerWorkspaceSelection>({ kind: 'instructor' })
  const workspaceSelectionRef = useRef<MobCodeManagerWorkspaceSelection>(workspaceSelection)
  const [selectedStudentActiveFile, setSelectedStudentActiveFile] = useState('')
  const [selectedSharedActiveFile, setSelectedSharedActiveFile] = useState('')
  const [isStudentsExpanded, setIsStudentsExpanded] = useState(false)
  const [sharedExampleParticipantId, setSharedExampleParticipantId] = useState<string | null>(null)
  const [sharedExampleWorkspace, setSharedExampleWorkspace] = useState<{ files: Record<string, string>; activeFile: string } | null>(null)
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharedWorkspacePersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSharedWorkspaceRef = useRef<{ files: Record<string, string>; activeFile: string } | null>(null)
  const latestStateRef = useRef<MobCodeStatePayload>(createStateSnapshot({}, ''))
  const latestFileSizeStatsRef = useRef(getMobCodeFileSizeStats({}))
  const lastLiveSyncAtRef = useRef(0)
  const lastPersistSyncAtRef = useRef(0)
  const pendingContentUpdateRef = useRef<{ path: string; content: string; selections: MobCodeSelectionRange[] } | null>(null)
  const presenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPresenceRef = useRef<{ path: string; selections: MobCodeSelectionRange[] } | null>(null)
  const lastPresenceSyncAtRef = useRef(0)

  useEffect(() => {
    if (embeddedManagerPasscodeExchange.isResolving) {
      return
    }
    setInstructorPasscode(embeddedManagerPasscodeExchange.passcode || fallbackInstructorPasscode)
  }, [
    embeddedManagerPasscodeExchange.isResolving,
    embeddedManagerPasscodeExchange.passcode,
    fallbackInstructorPasscode,
  ])

  useEffect(() => {
    latestStateRef.current = createStateSnapshot(files, activeFile)
  }, [files, activeFile])

  useEffect(() => {
    workspaceSelectionRef.current = workspaceSelection
  }, [workspaceSelection])

  const replaceFilesState = useCallback((nextFiles: Record<string, string>) => {
    latestFileSizeStatsRef.current = getMobCodeFileSizeStats(nextFiles)
    setFiles(nextFiles)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    void fetch(`/api/mobcode/${encodedSessionId}/session`)
      .then((res) => (res.ok ? res.json() as Promise<unknown> : null))
      .then(parseMobCodeManagerSessionSnapshot)
      .then((session) => {
        if (!session) return
        const nextFiles = session.instructorWorkspace.files
        const nextActiveFile = session.instructorWorkspace.activeFile
        latestStateRef.current = createStateSnapshot(nextFiles, nextActiveFile)
        replaceFilesState(nextFiles)
        setActiveFile(nextActiveFile)
        if (session.runnerId) {
          setRunnerId(session.runnerId)
        }
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
  }, [encodedSessionId, replaceFilesState, sessionId])

  const applyManagerSessionSnapshot = useCallback((data: MobCodeManagerSessionSnapshot) => {
    setTryItEnabled(data.tryItEnabled)
    setShareChangesEnabled(data.shareChangesEnabled)
    const normalizedStudents = data.students
    setStudentWorkspaces(normalizedStudents)
    setSelectedStudentActiveFile((current) => {
      const selection = workspaceSelectionRef.current
      if (selection.kind !== 'student') return current
      const selected = normalizedStudents.find((student) => student.participantId === selection.participantId)
      return selected ? resolveActiveFile(selected.files, current || selected.activeFile) : current
    })
    setSharedExampleParticipantId(data.sharedExample?.sourceParticipantId ?? null)
    const nextSharedExampleWorkspace = data.sharedExample?.workspace ?? null
    setSharedExampleWorkspace(nextSharedExampleWorkspace)
    setSelectedSharedActiveFile((current) => {
      if (workspaceSelectionRef.current.kind !== 'shared' || nextSharedExampleWorkspace == null) return current
      return resolveActiveFile(nextSharedExampleWorkspace.files, current || nextSharedExampleWorkspace.activeFile)
    })
    setWorkspaceSelection((current) => {
      if (current.kind === 'student' && !normalizedStudents.some((student) => student.participantId === current.participantId)) {
        return { kind: 'instructor' }
      }
      if (current.kind === 'shared' && nextSharedExampleWorkspace == null) {
        return { kind: 'instructor' }
      }
      return current
    })
  }, [])

  const refreshStudentWorkspaces = useCallback(async () => {
    if (isSolo || !sessionId || !instructorPasscode) return
    try {
      const response = await fetch(`/api/mobcode/${encodedSessionId}/manager-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instructorPasscode }),
      })
      if (!response.ok) return
      const session = parseMobCodeManagerSessionSnapshot(await response.json())
      if (!session) return
      applyManagerSessionSnapshot(session)
    } catch (error) {
      console.error('Failed to fetch MobCode student-code settings:', error)
    }
  }, [applyManagerSessionSnapshot, encodedSessionId, instructorPasscode, isSolo, sessionId])

  useEffect(() => {
    void refreshStudentWorkspaces()
  }, [refreshStudentWorkspaces])

  const updateStudentCodeSetting = useCallback(async (action: 'try-it' | 'share-changes' | 'share-example' | 'unshare-example', body: Record<string, unknown> = {}) => {
    if (!sessionId || !instructorPasscode) return
    if (action === 'share-changes') {
      setShareChangesEnabled(body.enabled === true)
    }
    try {
      const response = await fetch(`/api/mobcode/${encodedSessionId}/student-code/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instructorPasscode, ...body }),
      })
      if (!response.ok) throw new Error('Could not update student code settings.')
      const session = parseMobCodeManagerSessionSnapshot(await response.json())
      if (!session) throw new Error('Invalid MobCode manager response.')
      applyManagerSessionSnapshot(session)
      if (action === 'share-example') {
        const sharedFiles = session.sharedExample?.workspace.files ?? {}
        setWorkspaceSelection({ kind: 'shared' })
        setSelectedSharedActiveFile(session.sharedExample?.workspace.activeFile ?? resolveActiveFile(sharedFiles, ''))
      }
      setStudentCodeMessage(action === 'try-it' ? (body.enabled === true ? 'Try it enabled. Students can edit their own code.' : 'Try it disabled.') : action === 'share-changes' ? (body.enabled === true ? 'Sharing instructor changes live.' : 'Instructor changes are private until shared again.') : action === 'share-example' ? 'Student work shared anonymously as a runnable example.' : 'Shared example removed.')
    } catch (error) {
      if (action === 'share-changes') {
        setShareChangesEnabled(body.enabled !== true)
      }
      setStudentCodeMessage(error instanceof Error ? error.message : 'Could not update student code settings.')
    }
  }, [applyManagerSessionSnapshot, encodedSessionId, instructorPasscode, sessionId])

  const buildWsUrl = useCallback(() => {
    if (isSolo || !sessionId) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId, role: 'manager' })
    return `${protocol}//${window.location.host}/ws/mobcode?${params.toString()}`
  }, [isSolo, sessionId])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: !isSolo,
    onOpen: (_event, ws) => {
      const authMessage = createMobCodeManagerAuthMessage(sessionId, instructorPasscode)
      if (authMessage) {
        ws.send(authMessage)
      }
    },
    onMessage: (event) => {
      const msg = parseMobCodeMessage(event.data)
      if (!msg) return
      if (
        msg.type === MOB_CODE_MESSAGE_TYPES.STUDENT_CODE_UPDATED
        || msg.type === MOB_CODE_MESSAGE_TYPES.STUDENT_CODE_SETTINGS_CHANGED
      ) {
        void refreshStudentWorkspaces()
        return
      }
      if (!isStatePayload(msg.payload)) return
      if (!shouldApplyRemoteStateMessage(msg.type, canEdit)) return
      if (msg.type === MOB_CODE_MESSAGE_TYPES.STATE_SYNC || msg.type === MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED) {
        replaceFilesState(msg.payload.files)
        setActiveFile(msg.payload.activeFile)
      }
    },
  })

  useEffect(() => {
    if (isSolo) return
    const socket = socketRef.current
    const authMessage = resolveOpenMobCodeManagerAuthMessage({
      sessionId,
      instructorPasscode,
      readyState: socket?.readyState,
    })
    if (!socket || !authMessage) {
      return
    }
    socket.send(authMessage)
  }, [instructorPasscode, isSolo, sessionId, socketRef])

  const persistState = useCallback(
    async (payload: MobCodeStatePayload, messageType: DurableMobCodeMessageType = MOB_CODE_MESSAGE_TYPES.STATE_SYNC) => {
      const credential = isSolo ? soloEditToken : instructorPasscode
      if (!sessionId || (!isSolo && !credential)) return
      try {
        const response = await fetch(`/api/mobcode/${encodedSessionId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            ...(isSolo && soloEditToken ? { soloEditToken } : !isSolo ? { instructorPasscode } : {}),
            messageType,
          }),
        })
        if (!response.ok) {
          throw new Error(`MobCode state persist failed with status ${response.status}`)
        }
      } catch (error) {
        console.error('Failed to persist MobCode state:', error)
      }
    },
    [encodedSessionId, instructorPasscode, isSolo, sessionId, soloEditToken],
  )

  const sendWsMessage = useCallback(
    (type: MobCodeMessageType, payload: unknown): boolean => {
      if (isSolo || !sessionId || !instructorPasscode) return false
      return sendMobCodeWsMessage(socketRef.current, { type, sessionId, payload })
    },
    [instructorPasscode, isSolo, sessionId, socketRef],
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
      if (!isSolo) {
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
      }

      schedulePersistSync()
    },
    [flushPendingContentSync, isSolo, schedulePersistSync],
  )

  const schedulePresenceSync = useCallback(
    (path: string, selections: MobCodeSelectionRange[]) => {
      if (isSolo) return
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
    [flushPendingPresenceSync, isSolo],
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
    if (isSolo) {
      return () => {
        const hasPendingPersist = persistDebounceRef.current != null
        if (persistDebounceRef.current) {
          clearTimeout(persistDebounceRef.current)
          persistDebounceRef.current = null
        }
        if (hasPendingPersist) {
          flushPendingPersistSync()
        }
      }
    }
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
    isSolo,
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

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const selectedStudentWorkspace = workspaceSelection.kind === 'student'
    ? studentWorkspaces.find((student) => student.participantId === workspaceSelection.participantId) ?? null
    : null
  const isViewingStudentWorkspace = selectedStudentWorkspace != null
  const isViewingSharedExample = workspaceSelection.kind === 'shared'
  const visibleFiles = isViewingSharedExample
    ? sharedExampleWorkspace?.files ?? {}
    : selectedStudentWorkspace?.files ?? files
  const visibleActiveFile = isViewingSharedExample
    ? selectedSharedActiveFile
    : selectedStudentWorkspace ? selectedStudentActiveFile : activeFile
  const visibleActiveContent = visibleActiveFile ? visibleFiles[visibleActiveFile] ?? '' : ''
  const canEditVisibleWorkspace = canEdit && !isViewingStudentWorkspace

  const persistSharedWorkspace = useCallback(async (nextFiles: Record<string, string>, nextActiveFile: string) => {
    if (!sessionId || !instructorPasscode) return
    const response = await fetch(`/api/mobcode/${encodedSessionId}/shared-workspace/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructorPasscode, files: nextFiles, activeFile: nextActiveFile }),
    })
    if (!response.ok) throw new Error('Could not save shared code.')
  }, [encodedSessionId, instructorPasscode, sessionId])

  const flushSharedWorkspacePersist = useCallback(() => {
    sharedWorkspacePersistDebounceRef.current = null
    const pendingWorkspace = pendingSharedWorkspaceRef.current
    if (!pendingWorkspace) return
    pendingSharedWorkspaceRef.current = null
    void persistSharedWorkspace(pendingWorkspace.files, pendingWorkspace.activeFile).catch((error) => {
      void refreshStudentWorkspaces()
      setRunnerMessage(error instanceof Error ? error.message : 'Could not save shared code.')
    })
  }, [persistSharedWorkspace, refreshStudentWorkspaces])

  const applySharedWorkspace = useCallback((nextFiles: Record<string, string>, nextActiveFile: string) => {
    const nextWorkspace = { files: nextFiles, activeFile: nextActiveFile }
    setSharedExampleWorkspace(nextWorkspace)
    setSelectedSharedActiveFile(nextActiveFile)
    pendingSharedWorkspaceRef.current = nextWorkspace
    if (sharedWorkspacePersistDebounceRef.current == null) {
      sharedWorkspacePersistDebounceRef.current = setTimeout(flushSharedWorkspacePersist, LIVE_CONTENT_SYNC_INTERVAL_MS)
    }
  }, [flushSharedWorkspacePersist])

  useEffect(() => () => {
    if (sharedWorkspacePersistDebounceRef.current) {
      clearTimeout(sharedWorkspacePersistDebounceRef.current)
      sharedWorkspacePersistDebounceRef.current = null
    }
    flushSharedWorkspacePersist()
  }, [flushSharedWorkspacePersist])

  const applyVisibleFiles = useCallback((nextFiles: Record<string, string>, nextActiveFile: string) => {
    if (isViewingSharedExample) {
      applySharedWorkspace(nextFiles, nextActiveFile)
      return
    }
    applyFiles(nextFiles, nextActiveFile)
  }, [applyFiles, applySharedWorkspace, isViewingSharedExample])

  const importVisibleFiles = useCallback((importedFiles: Record<string, string>, skippedCount = 0) => {
    if (!canEditVisibleWorkspace) return
    const nextFiles = sanitizeFilesMap({ ...visibleFiles, ...importedFiles })
    const importedPaths = Object.keys(importedFiles).sort((a, b) => a.localeCompare(b))
    const focusPath = importedPaths.find((path) => Object.hasOwn(nextFiles, path)) ?? visibleActiveFile
    const nextActiveFile = resolveActiveFile(nextFiles, focusPath)
    setFileImportMessage(skippedCount > 0 ? `${skippedCount} files skipped` : '')
    applyVisibleFiles(nextFiles, nextActiveFile)
  }, [applyVisibleFiles, canEditVisibleWorkspace, visibleActiveFile, visibleFiles])

  const handleVisibleDroppedFiles = useCallback(async (droppedFiles: File[]) => {
    if (!canEditVisibleWorkspace) return
    try {
      const result = await extractImportedFiles(droppedFiles)
      importVisibleFiles(result.files, result.skipped.length)
    } catch (error) {
      setFileImportMessage(error instanceof Error ? error.message : 'Could not import dropped files')
    }
  }, [canEditVisibleWorkspace, importVisibleFiles])

  const handleRunCode = () => {
    const result = openMobCodeRunnerPopup({
      files: isViewingSharedExample ? sharedExampleWorkspace?.files ?? {} : selectedStudentWorkspace?.files ?? latestStateRef.current.files,
      activeFile: isViewingSharedExample ? selectedSharedActiveFile : selectedStudentWorkspace ? selectedStudentActiveFile : latestStateRef.current.activeFile,
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

  const editorThemeClassName = `mobcode-editor-theme-${theme}`

  const submitModal = (path: string) => {
    if (modalMode === 'create-file') {
      if (wouldPathConflict(visibleFiles, path)) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      const nextFiles = { ...visibleFiles, [path]: '' }
      applyVisibleFiles(nextFiles, path)
    } else if (modalMode === 'create-folder') {
      if (wouldPathConflict(visibleFiles, path)) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      const keepPath = `${path}/.keep`
      const nextFiles = { ...visibleFiles, [keepPath]: '' }
      applyVisibleFiles(nextFiles, keepPath)
    } else if (modalMode === 'rename' && renameTarget) {
      const nextFiles = renamePathInFiles(visibleFiles, renameTarget, path)
      if (nextFiles === visibleFiles) {
        setModalErrorMessage('A file or folder already exists at that path.')
        return
      }
      applyVisibleFiles(nextFiles, resolveActiveFile(nextFiles, renameActiveFilePath(visibleActiveFile, renameTarget, path)))
    }
    setModalErrorMessage('')
    setModalMode(null)
    setRenameTarget('')
  }

  return (
    <div className="mobcode-shell">
      {isSolo ? (
        <EditorToolbar
          files={files}
          theme={theme}
          centerControls={(
            <div className="mobcode-runner-actions">
              <RunnerControls
                files={files}
                runnerId={runnerId}
                runners={MOB_CODE_RUNNERS}
                onRunCode={handleRunCode}
                onRunnerChange={setRunnerId}
              />
            </div>
          )}
          onThemeChange={handleThemeChange}
          onUploadFiles={importFilesIntoWorkspace}
          onCreateFile={() => setModalMode('create-file')}
          onCreateFolder={() => setModalMode('create-folder')}
        />
      ) : (
        <SessionHeader
          activityName="Mob Code"
          sessionId={sessionId}
          includeBottomMargin={false}
          actionMenuLabel={canEditVisibleWorkspace ? 'Files' : undefined}
          actionMenuRole={canEditVisibleWorkspace ? 'menu' : undefined}
          actionMenuContent={canEditVisibleWorkspace ? (
            <FileControlsMenuContent
              files={visibleFiles}
              onUploadFiles={(uploadedFiles) => {
                importVisibleFiles(uploadedFiles)
              }}
              onCreateFile={() => setModalMode('create-file')}
              onCreateFolder={() => setModalMode('create-folder')}
              onMessageChange={setFileImportMessage}
            />
          ) : undefined}
          headerActions={(
            <div className="mobcode-header-actions">
              <SettingsMenu theme={theme} onThemeChange={handleThemeChange} label="Theme" />
            </div>
          )}
          centerHeaderActions={(
            <div className="mobcode-runner-actions">
              <RunnerControls
                files={visibleFiles}
                runnerId={runnerId}
                runners={MOB_CODE_RUNNERS}
                onRunCode={handleRunCode}
                onRunnerChange={setRunnerId}
              />
            </div>
          )}
        />
      )}
      {instructorAccessBanner === 'loading' && (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          role="status"
          aria-live="polite"
        >
          Loading instructor access…
        </div>
      )}
      {instructorAccessBanner === 'missing' && (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          role="alert"
        >
          Instructor edit credentials are not available in this tab. Rejoin from the create-session flow to persist changes.
        </div>
      )}
      {runnerMessage && (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          role="alert"
          aria-live="assertive"
        >
          {runnerMessage}
        </div>
      )}
      {studentCodeMessage && <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">{studentCodeMessage}</div>}
      <div className="mobcode-workspace">
        <aside className="mobcode-sidebar">
          {!isSolo && canEdit && <>
            <section className="border-b border-gray-200 p-3" aria-labelledby="mobcode-students-heading">
              <div className="mobcode-students-header-row">
                <h2 id="mobcode-students-heading" className="text-sm font-semibold">
                  <button
                    type="button"
                    className="mobcode-disclosure-button"
                    aria-expanded={isStudentsExpanded}
                    aria-controls="mobcode-students-roster"
                    onClick={() => setIsStudentsExpanded((expanded) => !expanded)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mobcode-disclosure-caret${isStudentsExpanded ? ' mobcode-disclosure-caret--open' : ''}`}
                    >
                      ▸
                    </span>
                    Students
                  </button>
                </h2>
                <button
                  type="button"
                  aria-pressed={tryItEnabled}
                  className={`mobcode-toggle-button${tryItEnabled ? ' mobcode-toggle-button--active' : ''}`}
                  title={tryItEnabled ? 'Try it is on' : 'Try it is off'}
                  onClick={() => void updateStudentCodeSetting('try-it', { enabled: !tryItEnabled })}
                >
                  <span
                    aria-hidden="true"
                    className={`mobcode-status-dot${tryItEnabled ? ' mobcode-status-dot--active' : ''}`}
                  />
                  Try it
                </button>
              </div>
              <div id="mobcode-students-roster" className="mt-2 space-y-1" hidden={!isStudentsExpanded}>
                {studentWorkspaces.length === 0 && <p className="text-sm text-gray-600">No student workspaces yet.</p>}
                {studentWorkspaces.map((student) => {
                  return (
                    <div key={student.participantId} className="mobcode-student-row">
                      <button
                        type="button"
                        className="mobcode-student-select"
                        aria-current={workspaceSelection.kind === 'student' && workspaceSelection.participantId === student.participantId ? 'true' : undefined}
                        onClick={() => {
                          setWorkspaceSelection({ kind: 'student', participantId: student.participantId })
                          setSelectedStudentActiveFile(student.activeFile)
                        }}
                      >
                        {student.displayName}
                      </button>
                      { sharedExampleParticipantId === student.participantId ? (
                        <button type="button" className="mobcode-student-action" onClick={() => void updateStudentCodeSetting('unshare-example')}>
                          Unshare
                        </button>
                      ) : (
                        <button type="button" className="mobcode-student-action" onClick={() => void updateStudentCodeSetting('share-example', { participantId: student.participantId })}>
                          Share
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
            <div className="mobcode-workspace-tabs-row border-b border-gray-200 p-2">
              <div className="mobcode-workspace-tabs" role="tablist" aria-label="Code workspaces">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceSelection.kind === 'instructor'}
                  className="mobcode-workspace-tab"
                  onClick={() => setWorkspaceSelection({ kind: 'instructor' })}
                >
                  Instructor
                </button>
                {sharedExampleWorkspace && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isViewingSharedExample}
                    className="mobcode-workspace-tab"
                    onClick={() => {
                      setWorkspaceSelection({ kind: 'shared' })
                      setSelectedSharedActiveFile((current) => resolveActiveFile(sharedExampleWorkspace.files, current || sharedExampleWorkspace.activeFile))
                    }}
                  >
                    Shared
                  </button>
                )}
                {selectedStudentWorkspace && (
                  <span className="mobcode-workspace-tab" aria-current="page">
                    {selectedStudentWorkspace.displayName}
                  </span>
                )}
              </div>
              {workspaceSelection.kind === 'instructor' && (
                <button
                  type="button"
                  aria-pressed={shareChangesEnabled}
                  className={`mobcode-toggle-button${shareChangesEnabled ? ' mobcode-toggle-button--active' : ''}`}
                  title={shareChangesEnabled ? 'Instructor changes are shared live' : 'Instructor changes are private'}
                  onClick={() => void updateStudentCodeSetting('share-changes', { enabled: !shareChangesEnabled })}
                >
                  <span aria-hidden="true" className={`mobcode-status-dot${shareChangesEnabled ? ' mobcode-status-dot--active' : ''}`} />
                  Broadcast
                </button>
              )}
            </div>
          </>}
          <VirtualFileExplorer
            files={visibleFiles}
            activePath={visibleActiveFile}
            allowCreate={canEditVisibleWorkspace}
            allowRename={canEditVisibleWorkspace}
            allowDelete={canEditVisibleWorkspace}
            dropPrompt="Drop files or zip archives here to import"
            onSelect={(path) => {
              if (isViewingSharedExample) {
                applySharedWorkspace(sharedExampleWorkspace?.files ?? {}, path)
                return
              }
              if (isViewingStudentWorkspace) {
                setSelectedStudentActiveFile(path)
                return
              }
              setActiveFile(path)
              if (!canEditVisibleWorkspace) return
              latestStateRef.current = applyActiveFileChange(latestStateRef.current, path)
              sendWsMessage(MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED, { activeFile: path })
              schedulePresenceSync(path, [{ anchor: 0, head: 0 }])
              void persistState(latestStateRef.current)
            }}
            onCreateFile={canEditVisibleWorkspace ? () => setModalMode('create-file') : undefined}
            onCreateFolder={canEditVisibleWorkspace ? () => setModalMode('create-folder') : undefined}
            onDropFiles={canEditVisibleWorkspace ? handleVisibleDroppedFiles : undefined}
            onRename={(path) => {
              if (!canEditVisibleWorkspace) return
              setRenameTarget(path)
              setModalMode('rename')
            }}
            onDelete={(path) => {
              if (!canEditVisibleWorkspace) return
              const nextFiles = deletePathFromFiles(visibleFiles, path)
              applyVisibleFiles(nextFiles, resolveActiveFile(nextFiles, visibleActiveFile))
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
          {visibleActiveFile ? (
            <CodeEditor
              value={visibleActiveContent}
              filename={visibleActiveFile}
              theme={theme}
              readOnly={!canEditVisibleWorkspace}
              onUpdate={(viewUpdate) => {
                if (!canEditVisibleWorkspace) return
                if (isViewingSharedExample && sharedExampleWorkspace && viewUpdate.docChanged) {
                  const nextFiles = { ...sharedExampleWorkspace.files, [visibleActiveFile]: viewUpdate.state.doc.toString() }
                  applySharedWorkspace(nextFiles, visibleActiveFile)
                  return
                }
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
