import { useCallback, useEffect, useState } from 'react'
import VirtualFileExplorer from '@src/components/common/VirtualFileExplorer'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import type { MobCodeThemeId } from '../../shared/types'
import CodeEditor from '../components/CodeEditor'
import EditorToolbar from '../components/EditorToolbar'
import { MOB_CODE_MESSAGE_TYPES } from '../utils/constants'
import { resolveActiveFile, sanitizeFilesMap } from '../utils/fileUtils'
import { getThemeFromCookie, setThemeCookie } from '../utils/themeUtils'
import { isStatePayload, parseMobCodeMessage } from '../manager/managerUtils'
import '../styles.css'

interface MobCodeStudentProps {
  sessionData: {
    sessionId: string
  }
}

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

export default function MobCodeStudent({ sessionData }: MobCodeStudentProps) {
  const { sessionId } = sessionData
  const attachSessionEndedHandler = useSessionEndedHandler()
  const [files, setFiles] = useState<Record<string, string>>({})
  const [activeFile, setActiveFile] = useState('')
  const [theme, setTheme] = useState<MobCodeThemeId>(() => getThemeFromCookie())

  useEffect(() => {
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
        setFiles(msg.payload.files)
        setActiveFile(msg.payload.activeFile)
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.FILE_CONTENT_UPDATE) {
        const payload = msg.payload as { path?: unknown; content?: unknown }
        if (typeof payload.path === 'string' && typeof payload.content === 'string') {
          setFiles((current) => ({ ...current, [payload.path as string]: payload.content as string }))
        }
      } else if (msg.type === MOB_CODE_MESSAGE_TYPES.ACTIVE_FILE_CHANGED) {
        const payload = msg.payload as { activeFile?: unknown }
        if (typeof payload.activeFile === 'string') setActiveFile(payload.activeFile)
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

  return (
    <div className="mobcode-shell">
      <EditorToolbar files={files} readOnly theme={theme} onThemeChange={handleThemeChange} />
      <div className="mobcode-workspace">
        <aside className="mobcode-sidebar">
          <VirtualFileExplorer files={files} activePath={activeFile} readOnly onSelect={setActiveFile} />
        </aside>
        <main className="mobcode-editor-pane">
          {activeFile ? (
            <CodeEditor value={files[activeFile] ?? ''} filename={activeFile} theme={theme} readOnly />
          ) : (
            <div className="mobcode-empty">Waiting for instructor to load code...</div>
          )}
        </main>
      </div>
    </div>
  )
}
