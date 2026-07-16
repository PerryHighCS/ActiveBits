import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
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

interface SessionResponse {
  data?: {
    runnerId?: unknown
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
  const soloEditToken = new URLSearchParams(location.search).get('mobcodeSoloToken')

  return soloEditToken
    ? <MobCodeManager sessionIdOverride={sessionData.sessionId} soloEditToken={soloEditToken} />
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
  const latestFilesRef = useRef<Record<string, string>>({})

  useEffect(() => {
    void fetch(`/api/mobcode/${encodedSessionId}/session`)
      .then((res) => (res.ok ? res.json() as Promise<SessionResponse> : null))
      .then((session) => {
        if (!session) return
        const nextFiles = sanitizeFilesMap(session.data?.groups?.default?.files)
        latestFilesRef.current = nextFiles
        setFiles(nextFiles)
        setActiveFile(resolveActiveFile(nextFiles, session.data?.groups?.default?.activeFile))
        setRunnerId(isMobCodeRunnerId(session.data?.runnerId) ? session.data.runnerId : DEFAULT_MOB_CODE_RUNNER_ID)
        setRunnerMessage('')
        setInstructorPresence(null)
      })
      .catch((error) => console.error('Failed to fetch MobCode session:', error))
  }, [encodedSessionId, sessionId])

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
      if (
        (msg.type === MOB_CODE_MESSAGE_TYPES.STATE_SYNC || msg.type === MOB_CODE_MESSAGE_TYPES.FILE_TREE_CHANGED) &&
        isStatePayload(msg.payload)
      ) {
        const nextFiles = msg.payload.files
        latestFilesRef.current = nextFiles
        setFiles(nextFiles)
        setActiveFile(resolveActiveFile(nextFiles, msg.payload.activeFile))
        setInstructorPresence((current) => {
          if (current == null || Object.hasOwn(nextFiles, current.path)) return current
          return null
        })
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.FILE_CONTENT_UPDATE) {
        const payload = msg.payload as { path?: unknown; content?: unknown }
        if (typeof payload.path === 'string' && typeof payload.content === 'string') {
          setFiles((current) => {
            const next = applyStudentFileContentUpdate(current, payload.path as string, payload.content as string)
            latestFilesRef.current = next
            return next
          })
        }
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED) {
        const payload = msg.payload as { activeFile?: unknown }
        setActiveFile((current) =>
          resolveStudentActiveFileChange(latestFilesRef.current, current, payload.activeFile),
        )
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.EDITOR_PRESENCE_UPDATE) {
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
    const result = openMobCodeRunnerPopup({
      files,
      activeFile,
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
  const studentRunners = getStudentRunnerOptions(runnerId)

  return (
    <div className="mobcode-shell">
      <EditorToolbar
        files={files}
        readOnly
        theme={theme}
        centerControls={(
          <div className="mobcode-runner-actions">
            <RunnerControls
              files={files}
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
          <VirtualFileExplorer files={files} activePath={activeFile} readOnly onSelect={setActiveFile} />
        </aside>
        <main className={`mobcode-editor-pane ${editorThemeClassName}`}>
          {activeFile ? (
            <CodeEditor
              value={files[activeFile] ?? ''}
              filename={activeFile}
              theme={theme}
              readOnly
              remotePresence={instructorPresence}
            />
          ) : (
            <div className="mobcode-empty">Waiting for instructor to load code...</div>
          )}
        </main>
      </div>
    </div>
  )
}
