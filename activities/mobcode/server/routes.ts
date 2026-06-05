import type { Request, Response } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  MobCodeEditorPresencePayload,
  MobCodeGroupState,
  MobCodeMessage,
  MobCodeSelectionRange,
  MobCodeSessionData,
  MobCodeStatePayload,
} from '../shared/types.js'

interface MobCodeSessionStore extends Pick<SessionStore, 'get' | 'set'> {
  publishBroadcast?: (channel: string, message: Record<string, unknown>) => Promise<void>
  subscribeToBroadcast?: (channel: string, handler: (message: unknown) => void) => void
  valkeyStore?: SessionStore['valkeyStore']
}

interface AppLike {
  post(path: string, handler: (req: Request, res: Response) => Promise<void>): void
  get(path: string, handler: (req: Request, res: Response) => Promise<void>): void
}

interface MobCodeSocket extends ActiveBitsWebSocket {
  mobCodeRole?: 'manager' | 'student'
  instructorPasscode?: string | null
}

interface EmbeddedMobCodeLaunchOptions {
  files?: unknown
  activeFile?: unknown
}

const DEFAULT_GROUP_ID = 'default'
const MAX_FILES = 250
const MAX_PATH_LENGTH = 240
const MAX_FILE_CONTENT_LENGTH = 1_000_000
const MAX_TOTAL_CONTENT_LENGTH = 4 * 1024 * 1024
const INSTRUCTOR_PASSCODE_BYTES = 16
const MAX_INSTRUCTOR_PASSCODE_LENGTH = 512
const MAX_PRESENCE_SELECTIONS = 16
const WS_OPEN = 1
const DURABLE_MESSAGE_TYPES = new Set<MobCodeMessage['type']>(['state-sync', 'file-tree-changed'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

function isSafePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH || path.includes('\0')) return false
  return path.split('/').every((part) => part !== '.' && part !== '..')
}

function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function getTotalFileBytes(files: Record<string, string>): number {
  return Object.values(files).reduce((total, content) => total + getUtf8ByteLength(content), 0)
}

function truncateUtf8ToByteLimit(value: string, maxBytes: number): string {
  if (getUtf8ByteLength(value) <= maxBytes) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (getUtf8ByteLength(value.slice(0, mid)) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return value.slice(0, low)
}

function normalizeFiles(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  const normalizedEntries: Array<[string, string]> = []
  const impliedFolderPaths = new Set<string>()
  const seenPaths = new Set<string>()
  const files: Record<string, string> = {}
  let totalBytes = 0
  let fileCount = 0

  for (const [rawPath, rawContent] of Object.entries(value)) {
    if (fileCount >= MAX_FILES) break
    const path = normalizePath(rawPath)
    if (!isSafePath(path) || seenPaths.has(path) || typeof rawContent !== 'string') continue
    seenPaths.add(path)
    const content = truncateUtf8ToByteLimit(rawContent, MAX_FILE_CONTENT_LENGTH)
    totalBytes += getUtf8ByteLength(content)
    if (totalBytes > MAX_TOTAL_CONTENT_LENGTH) break
    normalizedEntries.push([path, content])
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      impliedFolderPaths.add(segments.slice(0, index).join('/'))
    }
    fileCount += 1
  }

  for (const [path, content] of normalizedEntries) {
    if (impliedFolderPaths.has(path)) continue
    files[path] = content
  }

  return files
}

function readEmbeddedStarterState(source: Record<string, unknown>): MobCodeGroupState | null {
  const embeddedLaunch = isPlainObject(source.embeddedLaunch) ? source.embeddedLaunch : null
  const selectedOptions = isPlainObject(embeddedLaunch?.selectedOptions) ? embeddedLaunch.selectedOptions : null
  if (!selectedOptions) {
    return null
  }

  const { files: rawFiles, activeFile } = selectedOptions as EmbeddedMobCodeLaunchOptions
  if (!isPlainObject(rawFiles)) {
    return null
  }

  const files = normalizeFiles(rawFiles)
  return {
    files,
    activeFile: resolveActiveFile(files, activeFile),
  }
}

function resolveActiveFile(files: Record<string, string>, activeFile: unknown): string {
  if (typeof activeFile === 'string' && Object.hasOwn(files, activeFile)) return activeFile
  return Object.keys(files).sort((a, b) => a.localeCompare(b))[0] ?? ''
}

export function normalizeMobCodeSessionData(data: unknown): MobCodeSessionData {
  const source = isPlainObject(data) ? data : {}
  const { instructorPasscode, ...restSource } = source
  const groupsSource = isPlainObject(source.groups) ? source.groups : {}
  const hasExplicitDefaultGroup = isPlainObject(groupsSource[DEFAULT_GROUP_ID])
  const defaultSource = hasExplicitDefaultGroup ? groupsSource[DEFAULT_GROUP_ID] as Record<string, unknown> : {}
  const embeddedStarterState = hasExplicitDefaultGroup ? null : readEmbeddedStarterState(source)
  const defaultGroup: MobCodeGroupState = embeddedStarterState ?? (() => {
    const files = normalizeFiles(defaultSource.files)
    return {
      files,
      activeFile: resolveActiveFile(files, defaultSource.activeFile),
    }
  })()

  return {
    ...restSource,
    groups: {
      ...groupsSource,
      [DEFAULT_GROUP_ID]: defaultGroup,
    },
    instructorPasscode:
      typeof instructorPasscode === 'string' &&
      instructorPasscode.length > 0 &&
      instructorPasscode.length <= MAX_INSTRUCTOR_PASSCODE_LENGTH
      ? instructorPasscode
      : createInstructorPasscode(),
  }
}

function asMobCodeSession(session: SessionRecord | null): (SessionRecord & { data: MobCodeSessionData }) | null {
  if (!session || session.type !== 'mobcode') return null
  return session as SessionRecord & { data: MobCodeSessionData }
}

function createInstructorPasscode(): string {
  return randomBytes(INSTRUCTOR_PASSCODE_BYTES).toString('hex')
}

function verifyPasscode(expected: string | undefined, candidate: unknown): boolean {
  if (typeof expected !== 'string' || typeof candidate !== 'string') return false
  if (
    candidate.length === 0 ||
    candidate.length > MAX_INSTRUCTOR_PASSCODE_LENGTH ||
    expected.length !== candidate.length
  ) return false
  const expectedBuffer = Buffer.from(expected)
  const candidateBuffer = Buffer.from(candidate)
  if (expectedBuffer.length === 0 || expectedBuffer.length !== candidateBuffer.length) return false

  try {
    return timingSafeEqual(expectedBuffer, candidateBuffer)
  } catch {
    return false
  }
}

export function readStatePayload(value: unknown): MobCodeStatePayload | null {
  if (!isPlainObject(value) || !isPlainObject(value.files) || typeof value.activeFile !== 'string') return null
  const source = value
  const files = normalizeFiles(source.files)
  return {
    files,
    activeFile: resolveActiveFile(files, source.activeFile),
  }
}

export function readDurableMessageType(value: unknown): MobCodeMessage['type'] {
  return typeof value === 'string' && DURABLE_MESSAGE_TYPES.has(value as MobCodeMessage['type'])
    ? value as MobCodeMessage['type']
    : 'state-sync'
}

export function readWsRelayMessage(
  message: MobCodeMessage,
  files: Record<string, string>,
): MobCodeMessage | null {
  if (message.type === 'file-content-update') {
    if (!isPlainObject(message.payload)) return null
    const { path, content } = message.payload
    if (
      typeof path !== 'string' ||
      !isSafePath(path) ||
      !Object.hasOwn(files, path) ||
      typeof content !== 'string' ||
      getUtf8ByteLength(content) > MAX_FILE_CONTENT_LENGTH
    ) {
      return null
    }

    const currentTotalBytes = getTotalFileBytes(files)
    const currentFileBytes = getUtf8ByteLength(files[path] ?? '')
    const nextFileBytes = getUtf8ByteLength(content)
    if (currentTotalBytes - currentFileBytes + nextFileBytes > MAX_TOTAL_CONTENT_LENGTH) {
      return null
    }

    return {
      type: message.type,
      payload: { path, content },
    }
  }

  if (message.type === 'active-file-changed') {
    if (!isPlainObject(message.payload)) return null
    const { activeFile } = message.payload
    if (typeof activeFile !== 'string' || !isSafePath(activeFile) || !Object.hasOwn(files, activeFile)) {
      return null
    }

    return {
      type: message.type,
      payload: { activeFile },
    }
  }

  if (message.type === 'editor-presence-update') {
    if (!isPlainObject(message.payload)) return null
    const { path, selections } = message.payload
    if (
      typeof path !== 'string' ||
      !isSafePath(path) ||
      !Object.hasOwn(files, path) ||
      !Array.isArray(selections) ||
      selections.length > MAX_PRESENCE_SELECTIONS
    ) {
      return null
    }

    const currentFileLength = files[path]?.length ?? 0
    const normalizedSelections: MobCodeSelectionRange[] = []
    for (const selection of selections) {
      if (!isPlainObject(selection)) return null
      const { anchor, head } = selection as Partial<MobCodeSelectionRange>
      if (
        !Number.isInteger(anchor) ||
        !Number.isInteger(head) ||
        (anchor as number) < 0 ||
        (head as number) < 0 ||
        (anchor as number) > currentFileLength ||
        (head as number) > currentFileLength
      ) {
        return null
      }
      normalizedSelections.push({ anchor: anchor as number, head: head as number })
    }

    const payload: MobCodeEditorPresencePayload = { path, selections: normalizedSelections }
    return {
      type: message.type,
      payload,
    }
  }

  return null
}

export function applyWsRelayMessageToGroupState(
  group: MobCodeGroupState,
  message: MobCodeMessage,
): MobCodeGroupState {
  if (message.type === 'file-content-update' && isPlainObject(message.payload) && typeof message.payload.path === 'string') {
    return {
      ...group,
      files: {
        ...group.files,
        [message.payload.path]: typeof message.payload.content === 'string' ? message.payload.content : group.files[message.payload.path] ?? '',
      },
    }
  }

  if (message.type === 'active-file-changed' && isPlainObject(message.payload) && typeof message.payload.activeFile === 'string') {
    return {
      ...group,
      activeFile: message.payload.activeFile,
    }
  }

  return group
}

export function resolveWsValidationGroupState(
  persistedGroup: MobCodeGroupState | undefined,
  liveGroup: MobCodeGroupState | undefined,
): MobCodeGroupState {
  return liveGroup ?? persistedGroup ?? { files: {}, activeFile: '' }
}

export function readWsInstructorPasscode(message: MobCodeMessage): string | null {
  if (message.type !== 'manager-auth' || !isPlainObject(message.payload)) return null
  return (
    typeof message.payload.instructorPasscode === 'string' &&
    message.payload.instructorPasscode.length > 0 &&
    message.payload.instructorPasscode.length <= MAX_INSTRUCTOR_PASSCODE_LENGTH
  ) ? message.payload.instructorPasscode : null
}

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function parseWsMessage(data: unknown): MobCodeMessage | null {
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) return null
  try {
    const parsed = JSON.parse(String(data)) as MobCodeMessage
    return isPlainObject(parsed) && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

registerSessionNormalizer('mobcode', (session) => {
  session.data = normalizeMobCodeSessionData(session.data)
})

export default function setupMobCodeRoutes(app: AppLike, sessions: MobCodeSessionStore, ws: WsRouter): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)
  const liveGroupsBySession = new Map<string, MobCodeGroupState>()

  async function broadcast(type: string, payload: MobCodeStatePayload, sessionId: string): Promise<void> {
    const msgObj = { type, payload, timestamp: Date.now() }
    const msg = JSON.stringify(msgObj)
    if (sessions.publishBroadcast && sessions.valkeyStore != null) {
      try {
        await sessions.publishBroadcast(`session:${sessionId}:broadcast`, msgObj)
        return
      } catch (error) {
        console.error(JSON.stringify({ event: 'mobcode.broadcast-publish-failed', sessionId, error: String(error) }))
      }
    }

    for (const client of ws.wss.clients) {
      if (client.readyState === WS_OPEN && client.sessionId === sessionId) {
        try {
          client.send(msg)
        } catch {
          // Ignore failed sends; websocket liveness cleanup owns stale clients.
        }
      }
    }
  }

  ws.register('/ws/mobcode', (socket, query) => {
    const client = socket as MobCodeSocket
    client.sessionId = query.get('sessionId') || null
    client.mobCodeRole = query.get('role') === 'manager' ? 'manager' : 'student'
    client.instructorPasscode = null
    if (client.sessionId) {
      ensureBroadcastSubscription(client.sessionId)
    }

    client.on('message', (rawData) => {
      const msg = parseWsMessage(rawData)
      if (!msg || !client.sessionId) return
      const sessionId = client.sessionId
      if (msg.type === 'manager-auth') {
        if (client.mobCodeRole !== 'manager') return
        client.instructorPasscode = readWsInstructorPasscode(msg)
        return
      }
      if (
        msg.type !== 'file-content-update' &&
        msg.type !== 'active-file-changed' &&
        msg.type !== 'editor-presence-update'
      ) return
      if (client.mobCodeRole !== 'manager') return

      ;(async () => {
        const session = asMobCodeSession(await sessions.get(sessionId))
        if (!session || !verifyPasscode(session.data.instructorPasscode, client.instructorPasscode)) {
          console.warn(JSON.stringify({ event: 'mobcode.ws-mutation-denied', sessionId }))
          return
        }

        const currentGroup = resolveWsValidationGroupState(
          session.data.groups[DEFAULT_GROUP_ID],
          liveGroupsBySession.get(sessionId),
        )
        const relayMessage = readWsRelayMessage(msg, currentGroup.files)
        if (!relayMessage) {
          console.warn(JSON.stringify({ event: 'mobcode.ws-mutation-invalid', sessionId, type: msg.type }))
          return
        }

        const nextGroup = applyWsRelayMessageToGroupState(currentGroup, relayMessage)
        session.data.groups[DEFAULT_GROUP_ID] = nextGroup
        liveGroupsBySession.set(sessionId, nextGroup)

        const outgoing = JSON.stringify({ ...relayMessage, timestamp: Date.now() })
        for (const peer of ws.wss.clients) {
          if (peer !== client && peer.readyState === WS_OPEN && peer.sessionId === sessionId) {
            try {
              peer.send(outgoing)
            } catch {
              // Ignore failed sends; websocket liveness cleanup owns stale clients.
            }
          }
        }
      })().catch((error) => {
        console.error(JSON.stringify({ event: 'mobcode.ws-message-failed', sessionId, error: String(error) }))
      })
    })
  })

  app.post('/api/mobcode/create', async (_req, res) => {
    try {
      const instructorPasscode = createInstructorPasscode()
      const session = await createSession(sessions, {
        data: normalizeMobCodeSessionData({
          instructorPasscode,
          groups: {
            [DEFAULT_GROUP_ID]: {
              files: {},
              activeFile: '',
            },
          },
        }),
      })
      session.type = 'mobcode'
      await sessions.set(session.id, session)
      res.json({ id: session.id, instructorPasscode })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.create-failed', error: String(error) }))
      res.status(500).json({ error: 'Failed to create session' })
    }
  })

  app.get('/api/mobcode/:sessionId/session', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json({ id: session.id, type: session.type, data: { groups: session.data.groups } })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.fetch-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to fetch session' })
    }
  })

  app.post('/api/mobcode/:sessionId/state', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const body = isPlainObject(req.body) ? req.body : {}
      if (!verifyPasscode(session.data.instructorPasscode, body.instructorPasscode)) {
        console.warn(JSON.stringify({ event: 'mobcode.state-denied', sessionId: session.id }))
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const payload = readStatePayload(body)
      if (!payload) {
        res.status(400).json({ error: 'Invalid state payload' })
        return
      }

      session.data.groups[DEFAULT_GROUP_ID] = payload
      liveGroupsBySession.set(session.id, payload)
      await sessions.set(session.id, session)
      await broadcast(readDurableMessageType(body.messageType), payload, session.id)
      res.json({ ok: true })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.state-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to update state' })
    }
  })
}
