import { useCallback, useEffect, useRef, useState } from 'react'
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
import CodeEditor from '../components/CodeEditor'
import EditorToolbar from '../components/EditorToolbar'
import RunnerControls from '../components/RunnerControls'
import {
  DEFAULT_MOB_CODE_RUNNER_ID,
  MOB_CODE_RUNNERS,
  type MobCodeRunnerDefinition,
  openMobCodeRunnerPopup,
} from '../runner/runnerUtils'
import { MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import { resolveActiveFile, sanitizeFilesMap } from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { isStatePayload, parseMobCodeMessage } from '../manager/managerUtils'
import MobCodeManager from '../manager/MobCodeManager'
import '../styles.css'

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
    ? <MobCodeManager sessionIdOverride={sessionData.sessionId} soloEditToken={route.soloEditToken} soloMode />
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
  const previousTryItEnabledRef = useRef(false)
  const previousSharedExampleAvailableRef = useRef(false)
  const previousShareChangesEnabledRef = useRef(false)

  useEffect(() => {
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
        if (!session) return
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
        if (shouldAutoSelectMyCodeOnTryItStart(previousTryItEnabledRef.current, nextTryItEnabled, nextMyWorkspace != null)) {
          setWorkspaceView('mine')
        }
        previousTryItEnabledRef.current = nextTryItEnabled
        const sharedFiles = sanitizeFilesMap(session.data?.studentCode?.sharedExample?.workspace?.files)
        const nextSharedWorkspace = session.data?.studentCode?.sharedExample
          ? { files: sharedFiles, activeFile: resolveActiveFile(sharedFiles, session.data.studentCode.sharedExample.workspace?.activeFile) }
          : null
        const nextShareChangesEnabled = session.data?.studentCode?.shareChangesEnabled === true
        setShareChangesEnabled(nextShareChangesEnabled)
        if (!previousSharedExampleAvailableRef.current && nextSharedWorkspace != null) {
          setWorkspaceView('shared')
        } else if (!previousShareChangesEnabledRef.current && nextShareChangesEnabled) {
          setWorkspaceView('instructor')
        } else if (previousSharedExampleAvailableRef.current && nextSharedWorkspace == null) {
          setWorkspaceView('instructor')
        }
        previousSharedExampleAvailableRef.current = nextSharedWorkspace != null
        previousShareChangesEnabledRef.current = nextShareChangesEnabled
        setSharedWorkspace(nextSharedWorkspace)
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
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

  const handleThemeChange = (nextTheme: MobCodeThemeId) => {
    setTheme(nextTheme)
    setThemeCookie(nextTheme)
  }

  const handleRunCode = () => {
    const workspace = workspaceView === 'mine' ? myWorkspace : workspaceView === 'shared' ? sharedWorkspace : null
    const result = openMobCodeRunnerPopup({
      files: workspace?.files ?? files,
      activeFile: workspace?.activeFile ?? activeFile,
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

  const selectedWorkspace = workspaceView === 'mine' ? myWorkspace : workspaceView === 'shared' ? sharedWorkspace : null
  const selectedFiles = selectedWorkspace?.files ?? files
  const selectedActiveFile = selectedWorkspace?.activeFile ?? activeFile
  const canEditMyCode = workspaceView === 'mine' && tryItEnabled && myWorkspace != null

  const persistMyWorkspace = useCallback(async (nextFiles: Record<string, string>, nextActiveFile: string) => {
    const response = await fetch(`/api/mobcode/${encodedSessionId}/student-workspace/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: nextFiles, activeFile: nextActiveFile }),
    })
    if (response.status === 423) setTryItEnabled(false)
    if (!response.ok) throw new Error('Could not save your code.')
  }, [encodedSessionId])

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
    return <MobCodeManager sessionIdOverride={sessionId} soloMode />
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
            <div className="mobcode-workspace-tabs" role="tablist" aria-label="Code workspaces">
              <button type="button" role="tab" aria-selected={workspaceView === 'instructor'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('instructor')}>Instructor</button>
              {myWorkspace && <button type="button" role="tab" aria-selected={workspaceView === 'mine'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('mine')}>My Code</button>}
              {sharedWorkspace && <button type="button" role="tab" aria-selected={workspaceView === 'shared'} className="mobcode-workspace-tab" onClick={() => setWorkspaceView('shared')}>Shared</button>}
            </div>
            {workspaceView === 'mine' && !tryItEnabled && (
              <p className="mobcode-status-message mt-2 text-xs text-amber-800" role="status">
                <span aria-hidden="true" className="mobcode-status-dot" />
                Try it is off. Your code is safe, but editing is locked.
              </p>
            )}
            {workspaceView === 'mine' && starterVersionAvailable && !resetPending && (
              <button type="button" className="mobcode-text-button mt-2" onClick={() => setResetPending(true)}>
                Reset my code
              </button>
            )}
            {resetPending && (
              <div className="mobcode-confirm-panel mt-2" role="alert">
                <p>Replace only My code with the shared starter version? Instructor code and the shared example will not change.</p>
                <div className="mobcode-confirm-actions">
                  <button type="button" className="mobcode-confirm-danger" onClick={() => void resetMyCode()}>Reset my code</button>
                  <button type="button" className="mobcode-confirm-cancel" onClick={() => setResetPending(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <VirtualFileExplorer files={selectedFiles} activePath={selectedActiveFile} readOnly={!canEditMyCode} onSelect={(path) => {
            if (workspaceView === 'mine' && myWorkspace) setMyWorkspace({ ...myWorkspace, activeFile: path })
            else if (workspaceView === 'shared' && sharedWorkspace) setSharedWorkspace({ ...sharedWorkspace, activeFile: path })
            else setActiveFile(path)
          }} />
        </aside>
        <main className={`mobcode-editor-pane ${editorThemeClassName}`}>
          {selectedActiveFile ? (
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
                void persistMyWorkspace(nextFiles, selectedActiveFile).catch((error) => setRunnerMessage(error instanceof Error ? error.message : 'Could not save your code.'))
              }}
            />
          ) : (
            <div className="mobcode-empty">Waiting for instructor to load code...</div>
          )}
        </main>
      </div>
    </div>
  )
}
