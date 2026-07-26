import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import {
  buildSessionEntryParticipantStorageKey,
  consumeResolvedEntryParticipantValues,
  hasValidEntryParticipantHandoffStorageValue,
} from '@src/components/common/entryParticipantStorage'
import type { MobCodeEditorPresencePayload, MobCodeRunnerId, MobCodeThemeId } from '../../shared/types'
import { isMobCodeRunnerId } from '../../shared/types'
import EditorToolbar from '../components/EditorToolbar'
import RunnerControls from '../components/RunnerControls'
import {
  DEFAULT_MOB_CODE_RUNNER_ID,
  MOB_CODE_RUNNERS,
} from '../runner/runnerCatalog'
import { openMobCodeRunnerPopupShell } from '../runner/runnerPopupShell'
import type { MobCodeRunnerDefinition } from '../runner/runnerTypes'
import type { openMobCodeRunnerPopup, renderMobCodeRunnerPopup } from '../runner/runnerUtils'
import { MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import { resolveActiveFile, sanitizeFilesMap } from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { isStatePayload, parseMobCodeMessage } from '../manager/managerUtils'
import '../styles.css'

const MobCodeManager = lazy(() => import('../manager/MobCodeManager'))
const CodeEditor = lazy(() => import('../components/CodeEditor'))
type MobCodeRunnerRenderer = {
  openMobCodeRunnerPopup: typeof openMobCodeRunnerPopup
  renderMobCodeRunnerPopup: typeof renderMobCodeRunnerPopup
}

function MobCodeEditorLoading() {
  return <div className="mobcode-empty" role="status">Loading editor…</div>
}

interface MobCodeStudentProps {
  sessionData: {
    sessionId: string
  }
}

export type MobCodeStudentRoute =
  | { mode: 'solo'; soloEditToken: string }
  | { mode: 'live' }

const EMBEDDED_ENTRY_HANDOFF_WAIT_MS = 4_000
const EMBEDDED_ENTRY_HANDOFF_POLL_MS = 50

/** SyncDeck child sessions receive their opaque entry token asynchronously over its websocket. */
export function isEmbeddedMobCodeChildSession(sessionId: string): boolean {
  return sessionId.startsWith('CHILD:')
}

export function shouldAutoSelectMyCodeOnTryItStart(
  previousTryItEnabled: boolean,
  nextTryItEnabled: boolean,
  hasMyWorkspace: boolean,
): boolean {
  return !previousTryItEnabled && nextTryItEnabled && hasMyWorkspace
}

/** Switch immediately on the settings event; the subsequent snapshot creates/loads the workspace. */
export function shouldSelectMyCodeFromTryItSettings(previousTryItEnabled: boolean, nextTryItEnabled: boolean): boolean {
  return !previousTryItEnabled && nextTryItEnabled
}

export function shouldSelectInstructorFromBroadcastSettings(
  shouldSelectMyCode: boolean,
  previousShareChangesEnabled: boolean,
  nextShareChangesEnabled: boolean,
): boolean {
  return !shouldSelectMyCode && !previousShareChangesEnabled && nextShareChangesEnabled
}

function waitForEmbeddedEntryParticipantHandoff(sessionId: string): Promise<void> {
  if (typeof sessionStorage === 'undefined' || !isEmbeddedMobCodeChildSession(sessionId)) {
    return Promise.resolve()
  }

  const storageKey = buildSessionEntryParticipantStorageKey('mobcode', sessionId)
  if (hasValidEntryParticipantHandoffStorageValue(sessionStorage, storageKey)) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + EMBEDDED_ENTRY_HANDOFF_WAIT_MS
    const poll = () => {
      if (
        hasValidEntryParticipantHandoffStorageValue(sessionStorage, storageKey)
        || Date.now() >= deadline
      ) {
        resolve()
        return
      }
      setTimeout(poll, EMBEDDED_ENTRY_HANDOFF_POLL_MS)
    }
    setTimeout(poll, EMBEDDED_ENTRY_HANDOFF_POLL_MS)
  })
}

function readMobCodeSoloTokenFromHistoryState(locationState: unknown): string {
  if (locationState == null || typeof locationState !== 'object') return ''
  const token = (locationState as { mobcodeSoloToken?: unknown }).mobcodeSoloToken
  return typeof token === 'string' ? token.trim() : ''
}

function readMobCodeSoloTokenFromUrl(hash: string): string {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('mobcodeSoloToken')?.trim()
    || ''
}

export function resolveMobCodeStudentRoute(_search: string, locationState?: unknown, hash = ''): MobCodeStudentRoute {
  const soloEditToken = readMobCodeSoloTokenFromUrl(hash)
    || readMobCodeSoloTokenFromHistoryState(locationState)
  return soloEditToken ? { mode: 'solo', soloEditToken } : { mode: 'live' }
}

export function removeMobCodeSoloTokenFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('mobcodeSoloToken')
  const remainingSearch = params.toString()
  return remainingSearch ? `?${remainingSearch}` : ''
}

export function removeMobCodeSoloTokenFromHash(hash: string): string {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  params.delete('mobcodeSoloToken')
  const remainingHash = params.toString()
  return remainingHash ? `#${remainingHash}` : ''
}

interface SessionResponse {
  data?: {
    runnerId?: unknown
    canEditSolo?: unknown
    studentCode?: {
      tryItEnabled?: unknown
      shareChangesEnabled?: unknown
      starterVersionAvailable?: unknown
      ownWorkspace?: { files?: unknown; activeFile?: unknown } | null
      sharedExample?: { workspace?: { files?: unknown; activeFile?: unknown } } | null
    }
    groups?: {
      default?: {
        files?: unknown
        activeFile?: unknown
      }
    }
  }
}

interface RawPresenceSelection {
  anchor?: unknown
  head?: unknown
}

interface RawPresencePayload {
  path?: unknown
  selections?: unknown
}

export function applyStudentFileContentUpdate(
  currentFiles: Record<string, string>,
  path: string,
  content: string,
): Record<string, string> {
  if (!Object.hasOwn(currentFiles, path)) return currentFiles
  if (currentFiles[path] === content) return currentFiles
  return { ...currentFiles, [path]: content }
}

export function resolveStudentActiveFileChange(
  currentFiles: Record<string, string>,
  currentActiveFile: string,
  nextActiveFile: unknown,
): string {
  if (typeof nextActiveFile !== 'string') return currentActiveFile
  return Object.hasOwn(currentFiles, nextActiveFile) ? nextActiveFile : currentActiveFile
}

export function sanitizeStudentPresenceUpdate(
  currentFiles: Record<string, string>,
  payload: RawPresencePayload,
): MobCodeEditorPresencePayload | null {
  if (typeof payload.path !== 'string' || !Array.isArray(payload.selections)) return null
  const content = currentFiles[payload.path]
  if (typeof content !== 'string') return null

  const maxOffset = content.length
  const selections = payload.selections.flatMap((selection) => {
    if (selection == null || typeof selection !== 'object') return []
    const rawAnchor = (selection as RawPresenceSelection).anchor
    const rawHead = (selection as RawPresenceSelection).head
    if (
      typeof rawAnchor !== 'number' ||
      typeof rawHead !== 'number' ||
      !Number.isInteger(rawAnchor) ||
      !Number.isInteger(rawHead) ||
      rawAnchor < 0 ||
      rawHead < 0 ||
      rawAnchor > maxOffset ||
      rawHead > maxOffset
    ) {
      return []
    }
    const anchor = rawAnchor as number
    const head = rawHead as number
    return [{ anchor, head }]
  })

  if (selections.length !== payload.selections.length) return null
  return {
    path: payload.path,
    selections,
  }
}

export function getStudentRunnerOptions(
  runnerId: MobCodeRunnerId,
  runners: readonly MobCodeRunnerDefinition[] = MOB_CODE_RUNNERS,
): readonly MobCodeRunnerDefinition[] {
  const selectedRunners = runners.filter((runner) => runner.id === runnerId)
  return selectedRunners.length > 0
    ? selectedRunners
    : [{
        id: runnerId,
        label: 'Unavailable runner',
        description: 'The instructor-selected runner is not available in this browser.',
      }]
}

export default function MobCodeStudent({ sessionData }: MobCodeStudentProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const route = resolveMobCodeStudentRoute(location.search, location.state, location.hash)

  useEffect(() => {
    if (route.mode !== 'solo') return
    const nextSearch = removeMobCodeSoloTokenFromSearch(location.search)
    const nextHash = removeMobCodeSoloTokenFromHash(location.hash)
    if (nextSearch === location.search && nextHash === location.hash) return
    const currentRouterState = location.state != null && typeof location.state === 'object'
      ? location.state as Record<string, unknown>
      : {}
    void navigate(`${location.pathname}${nextSearch}${nextHash}`, {
      replace: true,
      state: { ...currentRouterState, mobcodeSoloToken: route.soloEditToken },
    })
  }, [location.hash, location.pathname, location.search, location.state, navigate, route])

  return route.mode === 'solo'
    ? (
        <Suspense fallback={<MobCodeEditorLoading />}>
          <MobCodeManager sessionIdOverride={sessionData.sessionId} soloEditToken={route.soloEditToken} soloMode />
        </Suspense>
      )
    : <MobCodeLiveStudent sessionData={sessionData} />
}

function MobCodeLiveStudent({ sessionData }: MobCodeStudentProps) {
  const { sessionId } = sessionData
  const encodedSessionId = encodeURIComponent(sessionId)
  const attachSessionEndedHandler = useSessionEndedHandler()
  const [files, setFiles] = useState<Record<string, string>>({})
  const [activeFile, setActiveFile] = useState('')
  const [runnerId, setRunnerId] = useState<MobCodeRunnerId>(DEFAULT_MOB_CODE_RUNNER_ID)
  const [runnerMessage, setRunnerMessage] = useState('')
  const [theme, setTheme] = useState<MobCodeThemeId>(() => getThemeFromCookie())
  const [instructorPresence, setInstructorPresence] = useState<MobCodeEditorPresencePayload | null>(null)
  const [canResumeSolo, setCanResumeSolo] = useState(false)
  const [tryItEnabled, setTryItEnabled] = useState(false)
  const [shareChangesEnabled, setShareChangesEnabled] = useState(false)
  const [starterVersionAvailable, setStarterVersionAvailable] = useState(false)
  const [myWorkspace, setMyWorkspace] = useState<{ files: Record<string, string>; activeFile: string } | null>(null)
  const [sharedWorkspace, setSharedWorkspace] = useState<{ files: Record<string, string>; activeFile: string } | null>(null)
  const [workspaceView, setWorkspaceView] = useState<'instructor' | 'mine' | 'shared'>('instructor')
  const [resetPending, setResetPending] = useState(false)
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0)
  const latestFilesRef = useRef<Record<string, string>>({})
  const myWorkspacePersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingMyWorkspaceRef = useRef<{ files: Record<string, string>; activeFile: string } | null>(null)
  const inFlightMyWorkspacePersistRef = useRef<Promise<void> | null>(null)
  const runnerRendererRef = useRef<MobCodeRunnerRenderer | null>(null)
  const previousTryItEnabledRef = useRef(false)
  const previousSharedExampleAvailableRef = useRef(false)
  const previousShareChangesEnabledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const openStudentWorkspace = async (): Promise<SessionResponse | null> => {
      if (typeof sessionStorage !== 'undefined') {
        await waitForEmbeddedEntryParticipantHandoff(sessionId)
        await consumeResolvedEntryParticipantValues(sessionStorage, {
          activityName: 'mobcode',
          sessionId,
          isSoloSession: false,
        })
      }
      let response = await fetch(`/api/mobcode/${encodedSessionId}/student-workspace`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })

      // SyncDeck can restore the child iframe from saved state before its websocket has
      // replayed the opaque entry token. Give that replay one more bounded chance before
      // falling back to the read-only instructor snapshot.
      if (
        response.status === 403
        && typeof sessionStorage !== 'undefined'
        && isEmbeddedMobCodeChildSession(sessionId)
      ) {
        await waitForEmbeddedEntryParticipantHandoff(sessionId)
        await consumeResolvedEntryParticipantValues(sessionStorage, {
          activityName: 'mobcode',
          sessionId,
          isSoloSession: false,
        })
        response = await fetch(`/api/mobcode/${encodedSessionId}/student-workspace`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
      }
      if (response.ok) return response.json() as Promise<SessionResponse>
      const fallback = await fetch(`/api/mobcode/${encodedSessionId}/session`)
      return fallback.ok ? fallback.json() as Promise<SessionResponse> : null
    }
    void openStudentWorkspace()
      .then((session) => {
        if (!session || cancelled) return
        const nextFiles = sanitizeFilesMap(session.data?.groups?.default?.files)
        latestFilesRef.current = nextFiles
        setFiles(nextFiles)
        setActiveFile(resolveActiveFile(nextFiles, session.data?.groups?.default?.activeFile))
        setRunnerId(isMobCodeRunnerId(session.data?.runnerId) ? session.data.runnerId : DEFAULT_MOB_CODE_RUNNER_ID)
        setRunnerMessage('')
        setInstructorPresence(null)
        setCanResumeSolo(session.data?.canEditSolo === true)
        const nextTryItEnabled = session.data?.studentCode?.tryItEnabled === true
        setTryItEnabled(nextTryItEnabled)
        setStarterVersionAvailable(session.data?.studentCode?.starterVersionAvailable === true)
        const ownFiles = sanitizeFilesMap(session.data?.studentCode?.ownWorkspace?.files)
        const nextMyWorkspace = session.data?.studentCode?.ownWorkspace
          ? { files: ownFiles, activeFile: resolveActiveFile(ownFiles, session.data.studentCode.ownWorkspace.activeFile) }
          : null
        setMyWorkspace(nextMyWorkspace)
        const shouldSelectMyCode = shouldAutoSelectMyCodeOnTryItStart(
          previousTryItEnabledRef.current,
          nextTryItEnabled,
          nextMyWorkspace != null,
        )
        if (shouldSelectMyCode) {
          setWorkspaceView('mine')
        }
        previousTryItEnabledRef.current = nextTryItEnabled
        const sharedFiles = sanitizeFilesMap(session.data?.studentCode?.sharedExample?.workspace?.files)
        const nextSharedWorkspace = session.data?.studentCode?.sharedExample
          ? { files: sharedFiles, activeFile: resolveActiveFile(sharedFiles, session.data.studentCode.sharedExample.workspace?.activeFile) }
          : null
        const nextShareChangesEnabled = session.data?.studentCode?.shareChangesEnabled === true
        setShareChangesEnabled(nextShareChangesEnabled)
        if (!shouldSelectMyCode && !previousSharedExampleAvailableRef.current && nextSharedWorkspace != null) {
          setWorkspaceView('shared')
        } else if (shouldSelectInstructorFromBroadcastSettings(
          shouldSelectMyCode,
          previousShareChangesEnabledRef.current,
          nextShareChangesEnabled,
        )) {
          setWorkspaceView('instructor')
        } else if (previousSharedExampleAvailableRef.current && nextSharedWorkspace == null) {
          setWorkspaceView('instructor')
        }
        previousSharedExampleAvailableRef.current = nextSharedWorkspace != null
        previousShareChangesEnabledRef.current = nextShareChangesEnabled
        setSharedWorkspace(nextSharedWorkspace)
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to fetch MobCode session:', error)
      })
    return () => {
      cancelled = true
    }
  }, [encodedSessionId, sessionId, workspaceRefresh])

  const buildWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/mobcode?${new URLSearchParams({ sessionId, role: 'student' }).toString()}`
  }, [sessionId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
    attachSessionEndedHandler,
    onMessage: (event) => {
      const msg = parseMobCodeMessage(event.data)
      if (!msg) return
      if (msg.type === MOB_CODE_MESSAGE_TYPES.STUDENT_CODE_SETTINGS_CHANGED) {
        const settingsPayload = msg.payload as {
          tryItEnabled?: unknown
          shareChangesEnabled?: unknown
          files?: unknown
          activeFile?: unknown
        }
        const nextTryItEnabled = settingsPayload.tryItEnabled === true
        const nextShareChangesEnabled = settingsPayload.shareChangesEnabled === true
        const shouldSelectMyCode = shouldSelectMyCodeFromTryItSettings(previousTryItEnabledRef.current, nextTryItEnabled)
        setTryItEnabled(nextTryItEnabled)
        previousTryItEnabledRef.current = nextTryItEnabled
        if (shouldSelectMyCode) {
          setWorkspaceView('mine')
        }
        const shouldSelectInstructor = shouldSelectInstructorFromBroadcastSettings(
          shouldSelectMyCode,
          previousShareChangesEnabledRef.current,
          nextShareChangesEnabled,
        )
        setShareChangesEnabled(nextShareChangesEnabled)
        previousShareChangesEnabledRef.current = nextShareChangesEnabled
        if (isStatePayload(settingsPayload)) {
          const nextFiles = settingsPayload.files
          latestFilesRef.current = nextFiles
          setFiles(nextFiles)
          setActiveFile(resolveActiveFile(nextFiles, settingsPayload.activeFile))
          if (shouldSelectInstructor) setWorkspaceView('instructor')
        }
        setWorkspaceRefresh((version) => version + 1)
        return
      }
      if (
        (msg.type === MOB_CODE_MESSAGE_TYPES.STATE_SYNC || msg.type === MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED) &&
        isStatePayload(msg.payload)
      ) {
        if (!shareChangesEnabled) return
        const nextFiles = msg.payload.files
        latestFilesRef.current = nextFiles
        setFiles(nextFiles)
        setActiveFile(resolveActiveFile(nextFiles, msg.payload.activeFile))
        setInstructorPresence((current) => {
          if (current == null || Object.hasOwn(nextFiles, current.path)) return current
          return null
        })
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.FILE_CONTENT_UPDATE) {
        if (!shareChangesEnabled) return
        const payload = msg.payload as { path?: unknown; content?: unknown }
        if (typeof payload.path === 'string' && typeof payload.content === 'string') {
          setFiles((current) => {
            const next = applyStudentFileContentUpdate(current, payload.path as string, payload.content as string)
            latestFilesRef.current = next
            return next
          })
        }
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED) {
        if (!shareChangesEnabled) return
        const payload = msg.payload as { activeFile?: unknown }
        setActiveFile((current) =>
          resolveStudentActiveFileChange(latestFilesRef.current, current, payload.activeFile),
        )
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.EDITOR_PRESENCE_UPDATE) {
        if (!shareChangesEnabled) return
        setInstructorPresence(
          sanitizeStudentPresenceUpdate(latestFilesRef.current, msg.payload as RawPresencePayload),
        )
      }
    },
  })

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  useEffect(() => {
    void import('../runner/runnerUtils').then((runnerRenderer) => {
      runnerRendererRef.current = runnerRenderer
    }).catch((error: unknown) => console.error('Failed to preload MobCode runner:', error))
  }, [])

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const handleRunCode = () => {
    const workspace = workspaceView === 'mine' ? myWorkspace : workspaceView === 'shared' ? sharedWorkspace : null
    const request = {
      files: workspace?.files ?? files,
      activeFile: workspace?.activeFile ?? activeFile,
      sessionId,
      runnerId,
    }
    const runnerRenderer = runnerRendererRef.current
    if (runnerRenderer) {
      const result = runnerRenderer.openMobCodeRunnerPopup(request)
      setRunnerMessage(
        result.opened
          ? ''
          : result.reason === 'missing-entry'
            ? 'Add or select a Python file before running it.'
            : result.reason === 'popup-blocked'
              ? 'The runner popup was blocked. Allow popups for this site and try again.'
              : 'That runner is not available yet.',
      )
      return
    }
    const shell = openMobCodeRunnerPopupShell()
    setRunnerMessage(
      shell.opened
        ? ''
        : shell.reason === 'popup-blocked'
            ? 'The runner popup was blocked. Allow popups for this site and try again.'
            : 'That runner is not available yet.',
    )
    if (!shell.opened || !shell.popup) return
    void import('../runner/runnerUtils').then(({ renderMobCodeRunnerPopup }) => {
      const result = renderMobCodeRunnerPopup(shell.popup!, request, window.location.origin)
      if (result.opened) return
      shell.popup?.close?.()
      setRunnerMessage(result.reason === 'missing-entry'
        ? 'Add or select a Python file before running it.'
        : 'That runner is not available yet.')
    }).catch(() => {
      shell.popup?.close?.()
      setRunnerMessage('Could not load the Python runner. Please try again.')
    })
  }

  const selectedWorkspace = workspaceView === 'mine' ? myWorkspace : workspaceView === 'shared' ? sharedWorkspace : null
  const selectedFiles = selectedWorkspace?.files ?? files
  const selectedActiveFile = selectedWorkspace?.activeFile ?? activeFile
  const canEditMyCode = workspaceView === 'mine' && tryItEnabled && myWorkspace != null

  const persistMyWorkspace = useCallback(async (
    nextFiles: Record<string, string>,
    nextActiveFile: string,
    updateUi = true,
  ) => {
    const response = await fetch(`/api/mobcode/${encodedSessionId}/student-workspace/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: nextFiles, activeFile: nextActiveFile }),
    })
    if (response.status === 423 && updateUi) setTryItEnabled(false)
    if (!response.ok) throw new Error('Could not save your code.')
  }, [encodedSessionId])

  const flushMyWorkspacePersist = useCallback((skipUiUpdates = false) => {
    myWorkspacePersistDebounceRef.current = null
    const pendingWorkspace = pendingMyWorkspaceRef.current
    if (!pendingWorkspace) return
    pendingMyWorkspaceRef.current = null
    const persist = (inFlightMyWorkspacePersistRef.current ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => persistMyWorkspace(pendingWorkspace.files, pendingWorkspace.activeFile, !skipUiUpdates))
    inFlightMyWorkspacePersistRef.current = persist
    void persist.catch((error) => {
      if (!skipUiUpdates) setRunnerMessage(error instanceof Error ? error.message : 'Could not save your code.')
    }).finally(() => {
      if (inFlightMyWorkspacePersistRef.current === persist) inFlightMyWorkspacePersistRef.current = null
    })
  }, [persistMyWorkspace])

  const scheduleMyWorkspacePersist = useCallback((nextFiles: Record<string, string>, nextActiveFile: string) => {
    pendingMyWorkspaceRef.current = { files: nextFiles, activeFile: nextActiveFile }
    if (myWorkspacePersistDebounceRef.current == null) {
      myWorkspacePersistDebounceRef.current = setTimeout(flushMyWorkspacePersist, 250)
    }
  }, [flushMyWorkspacePersist])

  useEffect(() => () => {
    if (myWorkspacePersistDebounceRef.current) {
      clearTimeout(myWorkspacePersistDebounceRef.current)
      myWorkspacePersistDebounceRef.current = null
    }
    flushMyWorkspacePersist(true)
  }, [flushMyWorkspacePersist])

  const resetMyCode = useCallback(async () => {
    try {
      const response = await fetch(`/api/mobcode/${encodedSessionId}/student-workspace/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!response.ok) throw new Error('Could not reset your code.')
      const payload = await response.json() as { workspace?: { files?: unknown; activeFile?: unknown } }
      const nextFiles = sanitizeFilesMap(payload.workspace?.files)
      setMyWorkspace({ files: nextFiles, activeFile: resolveActiveFile(nextFiles, payload.workspace?.activeFile) })
      setWorkspaceView('mine')
    } catch (error) {
      setRunnerMessage(error instanceof Error ? error.message : 'Could not reset your code.')
    } finally {
      setResetPending(false)
    }
  }, [encodedSessionId])

  const editorThemeClassName = `mobcode-editor-theme-${theme}`
  const studentRunners = getStudentRunnerOptions(runnerId)

  if (canResumeSolo) {
    return (
      <Suspense fallback={<MobCodeEditorLoading />}>
        <MobCodeManager sessionIdOverride={sessionId} soloMode />
      </Suspense>
    )
  }

  return (
    <div className="mobcode-shell">
      <EditorToolbar
        files={selectedFiles}
        readOnly={!canEditMyCode}
        theme={theme}
        centerControls={(
          <div className="mobcode-runner-actions">
            <RunnerControls
              files={selectedFiles}
              runnerId={runnerId}
              runners={studentRunners}
              onRunCode={handleRunCode}
              onRunnerChange={setRunnerId}
            />
          </div>
        )}
        onThemeChange={handleThemeChange}
      />
      {runnerMessage && (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          role="alert"
          aria-live="assertive"
        >
          {runnerMessage}
        </div>
      )}
      <div className="mobcode-workspace">
        <aside className="mobcode-sidebar">
          <div className="border-b border-gray-200 p-2">
            <div className="mobcode-workspace-tabs" role="group" aria-label="Code workspaces">
              <button type="button" aria-pressed={workspaceView === 'instructor'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('instructor')}>Instructor</button>
              {myWorkspace && <button type="button" aria-pressed={workspaceView === 'mine'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('mine')}>My Code</button>}
              {sharedWorkspace && <button type="button" aria-pressed={workspaceView === 'shared'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('shared')}>Shared</button>}
            </div>
            {workspaceView === 'mine' && !tryItEnabled && (
              <p className="mobcode-status-message mt-2 text-xs text-amber-800" role="status">
                <span aria-hidden="true" className="mobcode-status-dot" />
                Editing is locked.
              </p>
            )}
            {workspaceView === 'mine' && starterVersionAvailable && !resetPending && (
              <button type="button" className="mobcode-text-button mt-2" onClick={() => setResetPending(true)}>
                Reset my code
              </button>
            )}
            {resetPending && (
              <div className="mobcode-confirm-panel mt-2" role="alert">
                <p>Replace only My code with the shared starter version?</p>
                <div className="mobcode-confirm-actions">
                  <button type="button" className="mobcode-confirm-danger" onClick={() => void resetMyCode()}>Reset my code</button>
                  <button type="button" className="mobcode-confirm-cancel" onClick={() => setResetPending(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <VirtualFileExplorer files={selectedFiles} activePath={selectedActiveFile} readOnly={!canEditMyCode} onSelect={(path) => {
            if (workspaceView === 'mine' && myWorkspace) {
              const nextWorkspace = { ...myWorkspace, activeFile: path }
              setMyWorkspace(nextWorkspace)
              scheduleMyWorkspacePersist(nextWorkspace.files, path)
            }
            else if (workspaceView === 'shared' && sharedWorkspace) setSharedWorkspace({ ...sharedWorkspace, activeFile: path })
            else setActiveFile(path)
          }} />
        </aside>
        <main className={`mobcode-editor-pane ${editorThemeClassName}`}>
          {selectedActiveFile ? (
            <Suspense fallback={<MobCodeEditorLoading />}>
              <CodeEditor
                value={selectedFiles[selectedActiveFile] ?? ''}
                filename={selectedActiveFile}
                theme={theme}
                readOnly={!canEditMyCode}
                remotePresence={workspaceView === 'instructor' ? instructorPresence : null}
                onUpdate={(update) => {
                  if (!canEditMyCode || !update.docChanged) return
                  const nextFiles = { ...myWorkspace.files, [selectedActiveFile]: update.state.doc.toString() }
                  const nextWorkspace = { files: nextFiles, activeFile: selectedActiveFile }
                  setMyWorkspace(nextWorkspace)
                  scheduleMyWorkspacePersist(nextFiles, selectedActiveFile)
                }}
              />
            </Suspense>
          ) : (
            <div className="mobcode-empty">Waiting for instructor to load code...</div>
          )}
        </main>
      </div>
    </div>
  )
}
