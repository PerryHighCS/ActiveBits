import type { Request, Response } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { getSessionParticipantCookieName, resolveAcceptedEntryParticipantToken } from 'activebits-server/core/acceptedEntryParticipants.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  MobCodeEditorPresencePayload,
  MobCodeGroupState,
  MobCodeMessage,
  MobCodeRunnerId,
  MobCodeSelectionRange,
  MobCodeSessionData,
  MobCodeStudentCodeState,
  MobCodeStudentWorkspace,
  MobCodeStatePayload,
} from '../shared/types.js'
import { isMobCodeRunnerId } from '../shared/types.js'

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
  isAuthenticatedManager?: boolean
  instructorPasscode?: string | null
}

interface SessionScopedWsClient {
  readyState: number
  sessionId?: string | null
  mobCodeRole?: 'manager' | 'student'
  isAuthenticatedManager?: boolean
  instructorPasscode?: string | null
}

interface EmbeddedMobCodeLaunchOptions {
  files?: unknown
  activeFile?: unknown
  runnerId?: unknown
  startTryItMode?: unknown
}

const DEFAULT_GROUP_ID = 'default'
const MAX_FILES = 250
const MAX_PATH_LENGTH = 240
const MAX_FILE_CONTENT_LENGTH = 1_000_000
const MAX_TOTAL_CONTENT_LENGTH = 4 * 1024 * 1024
const MAX_STUDENT_WORKSPACES = 30
const MAX_STUDENT_WORKSPACE_BYTES = 512 * 1024
const MAX_STUDENT_CODE_BYTES = 20 * 1024 * 1024
const MAX_PARTICIPANT_ID_LENGTH = 128
const MAX_DISPLAY_NAME_LENGTH = 200
const INSTRUCTOR_PASSCODE_BYTES = 16
const MAX_INSTRUCTOR_PASSCODE_LENGTH = 512
const SOLO_EDIT_TOKEN_BYTES = 24
const MAX_PRESENCE_SELECTIONS = 16
const WS_OPEN = 1
const LIVE_GROUP_CLEANUP_DELAY_MS = 30_000
const SOLO_EDIT_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
const DURABLE_MESSAGE_TYPES = new Set<MobCodeMessage['type']>(['state-sync', 'file-tree-changed'])
const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

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
  return path.split('/').every((part) => (
    part !== '.' &&
    part !== '..' &&
    !RESERVED_PATH_SEGMENTS.has(part)
  ))
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

function normalizeGroupState(value: unknown, maxBytes?: number): MobCodeGroupState {
  if (!isPlainObject(value)) return { files: {}, activeFile: '' }
  const files = maxBytes == null ? normalizeFiles(value.files) : normalizeFilesToByteLimit(value.files, maxBytes)
  return { files, activeFile: resolveActiveFile(files, value.activeFile) }
}

function normalizeFilesToByteLimit(value: unknown, maxBytes: number): Record<string, string> {
  const fullFiles = normalizeFiles(value)
  const files: Record<string, string> = {}
  let totalBytes = 0
  for (const [path, content] of Object.entries(fullFiles)) {
    const remainingBytes = maxBytes - totalBytes
    if (remainingBytes <= 0) break
    const normalizedContent = truncateUtf8ToByteLimit(content, remainingBytes)
    files[path] = normalizedContent
    totalBytes += getUtf8ByteLength(normalizedContent)
  }
  return files
}

function cloneGroupState(group: MobCodeGroupState): MobCodeGroupState {
  return { files: { ...group.files }, activeFile: group.activeFile }
}

function getGroupBytes(group: MobCodeGroupState | null): number {
  return group ? getTotalFileBytes(group.files) : 0
}

function normalizeStudentCodeState(value: unknown, defaultGroup: MobCodeGroupState, source: Record<string, unknown>): MobCodeStudentCodeState {
  const raw = isPlainObject(value) ? value : {}
  const embeddedLaunch = isPlainObject(source.embeddedLaunch) ? source.embeddedLaunch : null
  const selectedOptions = isPlainObject(embeddedLaunch?.selectedOptions) ? embeddedLaunch.selectedOptions : null
  const startTryItMode = selectedOptions?.startTryItMode === true
  const tryItEnabled = raw.tryItEnabled === true || (startTryItMode && !isPlainObject(value))
  const shareChangesEnabled = raw.shareChangesEnabled === true
  const publishedInstructorVersion = isPlainObject(raw.publishedInstructorVersion)
    ? normalizeGroupState(raw.publishedInstructorVersion)
    : cloneGroupState(defaultGroup)
  const starterVersion = isPlainObject(raw.starterVersion)
    ? normalizeGroupState(raw.starterVersion, MAX_STUDENT_WORKSPACE_BYTES)
    : tryItEnabled ? normalizeGroupState(defaultGroup, MAX_STUDENT_WORKSPACE_BYTES) : null
  const workspaces: Record<string, MobCodeStudentWorkspace> = Object.create(null) as Record<string, MobCodeStudentWorkspace>
  const rawWorkspaces = isPlainObject(raw.studentWorkspaces) ? raw.studentWorkspaces : {}
  let workspaceBytes = getGroupBytes(starterVersion)
  const ordered = Object.entries(rawWorkspaces)
    .flatMap(([participantId, workspace]) => isValidParticipantId(participantId) && isPlainObject(workspace)
      ? [[participantId, workspace] as [string, Record<string, unknown>]]
      : [])
    .sort(([, left], [, right]) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))
  for (const [participantId, rawWorkspace] of ordered) {
    if (Object.keys(workspaces).length >= MAX_STUDENT_WORKSPACES) break
    const displayName = normalizeDisplayName(rawWorkspace.displayName)
    if (!displayName) continue
    const group = normalizeGroupState(rawWorkspace, MAX_STUDENT_WORKSPACE_BYTES)
    const nextBytes = workspaceBytes + getGroupBytes(group)
    if (nextBytes > MAX_STUDENT_CODE_BYTES) continue
    const createdAt = Number.isFinite(rawWorkspace.createdAt) ? Number(rawWorkspace.createdAt) : Date.now()
    const updatedAt = Number.isFinite(rawWorkspace.updatedAt) ? Number(rawWorkspace.updatedAt) : createdAt
    Object.defineProperty(workspaces, participantId, {
      value: { participantId, displayName, ...group, createdAt, updatedAt },
      enumerable: true,
      configurable: true,
      writable: true,
    })
    workspaceBytes = nextBytes
  }
  const rawShared = isPlainObject(raw.sharedExample) ? raw.sharedExample : null
  const sharedExample = rawShared && isValidParticipantId(rawShared.sourceParticipantId)
    ? { sourceParticipantId: rawShared.sourceParticipantId, workspace: normalizeGroupState(rawShared.workspace, MAX_STUDENT_WORKSPACE_BYTES), sharedAt: Number.isFinite(rawShared.sharedAt) ? Number(rawShared.sharedAt) : Date.now() }
    : null
  return { tryItEnabled, shareChangesEnabled, publishedInstructorVersion, starterVersion, studentWorkspaces: workspaces, sharedExample }
}

function isValidParticipantId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.trim().length > 0
    && value.trim().length <= MAX_PARTICIPANT_ID_LENGTH
    && !RESERVED_PATH_SEGMENTS.has(value.trim())
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
  return normalized || null
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

function readEmbeddedRunnerId(source: Record<string, unknown>): MobCodeRunnerId | null {
  const embeddedLaunch = isPlainObject(source.embeddedLaunch) ? source.embeddedLaunch : null
  const selectedOptions = isPlainObject(embeddedLaunch?.selectedOptions) ? embeddedLaunch.selectedOptions : null
  return isMobCodeRunnerId(selectedOptions?.runnerId) ? selectedOptions.runnerId : null
}

function resolveActiveFile(files: Record<string, string>, activeFile: unknown): string {
  if (typeof activeFile === 'string') {
    const normalizedActiveFile = normalizePath(activeFile)
    if (Object.hasOwn(files, normalizedActiveFile)) return normalizedActiveFile
  }
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

  const normalizedStudentCode = normalizeStudentCodeState(source.studentCode, defaultGroup, source)

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
    studentCode: normalizedStudentCode,
  }
}

export function buildMobCodeStudentSnapshot(
  data: MobCodeSessionData,
  participantId: string,
): Record<string, unknown> {
  const studentCode = data.studentCode ?? normalizeStudentCodeState(null, data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }, data)
  const ownWorkspace = Object.hasOwn(studentCode.studentWorkspaces, participantId)
    ? studentCode.studentWorkspaces[participantId]
    : null
  return {
    groups: { [DEFAULT_GROUP_ID]: studentCode.publishedInstructorVersion ?? data.groups[DEFAULT_GROUP_ID] },
    studentCode: {
      tryItEnabled: studentCode.tryItEnabled,
      shareChangesEnabled: studentCode.shareChangesEnabled,
      starterVersionAvailable: studentCode.starterVersion != null,
      ownWorkspace,
      sharedExample: studentCode.sharedExample == null ? null : { workspace: studentCode.sharedExample.workspace, sharedAt: studentCode.sharedExample.sharedAt },
    },
    runnerId: readEmbeddedRunnerId(data),
    soloMode: false,
    canEditSolo: false,
  }
}

export function buildMobCodeManagerSnapshot(data: MobCodeSessionData): Record<string, unknown> {
  const studentCode = data.studentCode ?? normalizeStudentCodeState(null, data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }, data)
  return {
    groups: data.groups,
    studentCode: {
      tryItEnabled: studentCode.tryItEnabled,
      shareChangesEnabled: studentCode.shareChangesEnabled,
      starterVersionAvailable: studentCode.starterVersion != null,
      starterVersion: studentCode.starterVersion,
      students: Object.values(studentCode.studentWorkspaces).map(({ participantId, displayName, files, activeFile, createdAt, updatedAt }) => ({ participantId, displayName, files, activeFile, createdAt, updatedAt })),
      sharedExample: studentCode.sharedExample,
    },
    runnerId: readEmbeddedRunnerId(data),
    soloMode: data.soloMode === true,
  }
}

function resolveStudentIdentity(session: SessionRecord, participantToken: unknown): { participantId: string; displayName: string } | null {
  const accepted = resolveAcceptedEntryParticipantToken(session, participantToken)
  if (!accepted || !isValidParticipantId(accepted.participantId)) return null
  const displayName = normalizeDisplayName(accepted.displayName)
  return displayName ? { participantId: accepted.participantId, displayName } : null
}

function createStudentWorkspace(
  data: MobCodeSessionData,
  identity: { participantId: string; displayName: string },
): MobCodeStudentWorkspace | null {
  const studentCode = data.studentCode
  if (!studentCode?.starterVersion) return null
  const existing = Object.hasOwn(studentCode.studentWorkspaces, identity.participantId)
    ? studentCode.studentWorkspaces[identity.participantId]
    : null
  if (existing) return existing
  if (Object.keys(studentCode.studentWorkspaces).length >= MAX_STUDENT_WORKSPACES) return null
  const now = Date.now()
  const group = normalizeGroupState(studentCode.starterVersion, MAX_STUDENT_WORKSPACE_BYTES)
  const workspace: MobCodeStudentWorkspace = { participantId: identity.participantId, displayName: identity.displayName, ...group, createdAt: now, updatedAt: now }
  Object.defineProperty(studentCode.studentWorkspaces, identity.participantId, {
    value: workspace,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return workspace
}

function replaceStudentWorkspace(
  data: MobCodeSessionData,
  identity: { participantId: string; displayName: string },
  group: MobCodeGroupState,
): MobCodeStudentWorkspace | null {
  const current = createStudentWorkspace(data, identity)
  if (!current || !data.studentCode) return null
  const nextWorkspace: MobCodeStudentWorkspace = {
    participantId: identity.participantId,
    displayName: identity.displayName,
    files: group.files,
    activeFile: group.activeFile,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  }
  Object.defineProperty(data.studentCode.studentWorkspaces, identity.participantId, {
    value: nextWorkspace,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return nextWorkspace
}

function asMobCodeSession(session: SessionRecord | null): (SessionRecord & { data: MobCodeSessionData }) | null {
  if (!session || session.type !== 'mobcode') return null
  return session as SessionRecord & { data: MobCodeSessionData }
}

function createInstructorPasscode(): string {
  return randomBytes(INSTRUCTOR_PASSCODE_BYTES).toString('hex')
}

function createSoloEditToken(): string {
  return randomBytes(SOLO_EDIT_TOKEN_BYTES).toString('hex')
}

function getSoloEditCookieName(sessionId: string): string {
  return `mobcode_solo_edit_${sessionId}`
}

function readRequestCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers?.cookie
  if (typeof cookieHeader !== 'string') return null
  const cookie = cookieHeader.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))
  if (!cookie) return null
  try {
    return decodeURIComponent(cookie.slice(name.length + 1))
  } catch {
    return null
  }
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

function mergeDurableStatePayload(
  requestedPayload: MobCodeStatePayload,
  liveGroup: MobCodeGroupState,
): MobCodeStatePayload {
  const mergedFiles = Object.fromEntries(
    Object.entries(requestedPayload.files).map(([path, content]) => [
      path,
      Object.hasOwn(liveGroup.files, path) ? liveGroup.files[path] ?? content : content,
    ]),
  )
  return {
    files: mergedFiles,
    activeFile: Object.hasOwn(mergedFiles, liveGroup.activeFile) ? liveGroup.activeFile : requestedPayload.activeFile,
  }
}

export function resolveDurableStatePayload(
  messageType: MobCodeMessage['type'],
  requestedPayload: MobCodeStatePayload,
  liveGroup: MobCodeGroupState | undefined,
  hasActiveManager: boolean,
): MobCodeStatePayload {
  if (!liveGroup || !hasActiveManager) return requestedPayload
  if (messageType === 'state-sync' || messageType === 'file-tree-changed') return mergeDurableStatePayload(requestedPayload, liveGroup)
  return requestedPayload
}

export function hasOpenSessionClients(
  clients: Iterable<SessionScopedWsClient>,
  sessionId: string,
): boolean {
  for (const client of clients) {
    if (client.readyState === WS_OPEN && client.sessionId === sessionId) {
      return true
    }
  }
  return false
}

export function hasOpenManagerSessionClients(
  clients: Iterable<SessionScopedWsClient>,
  sessionId: string,
  instructorPasscode: string | undefined,
): boolean {
  for (const client of clients) {
    if (
      client.readyState === WS_OPEN &&
      client.sessionId === sessionId &&
      client.mobCodeRole === 'manager' &&
      verifyPasscode(instructorPasscode, client.instructorPasscode)
    ) {
      return true
    }
  }
  return false
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
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws, (client, message) => {
    const audience = isPlainObject(message) && message.audience === 'managers' ? 'managers' : 'all'
    return audience === 'all' || (client as MobCodeSocket).isAuthenticatedManager === true
  })
  const liveGroupsBySession = new Map<string, MobCodeGroupState>()
  const liveGroupCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const cancelLiveGroupCleanup = (sessionId: string) => {
    const existingTimer = liveGroupCleanupTimers.get(sessionId)
    if (!existingTimer) return
    clearTimeout(existingTimer)
    liveGroupCleanupTimers.delete(sessionId)
  }

  const scheduleLiveGroupCleanup = (sessionId: string) => {
    cancelLiveGroupCleanup(sessionId)
    const timer = setTimeout(() => {
      liveGroupCleanupTimers.delete(sessionId)
      if (hasOpenSessionClients(ws.wss.clients as Iterable<SessionScopedWsClient>, sessionId)) {
        return
      }
      liveGroupsBySession.delete(sessionId)
    }, LIVE_GROUP_CLEANUP_DELAY_MS)
    timer.unref?.()
    liveGroupCleanupTimers.set(sessionId, timer)
  }

  async function broadcast(type: string, payload: MobCodeStatePayload, sessionId: string, audience: 'all' | 'managers' = 'all'): Promise<void> {
    const msgObj = { type, payload, timestamp: Date.now(), audience }
    const msg = JSON.stringify(msgObj)
    if (sessions.publishBroadcast && sessions.valkeyStore != null) {
      try {
        await sessions.publishBroadcast(`session:${sessionId}:broadcast`, msgObj)
      } catch (error) {
        console.error(JSON.stringify({ event: 'mobcode.broadcast-publish-failed', sessionId, error: String(error) }))
      }
    }

    for (const rawClient of ws.wss.clients) {
      const client = rawClient as MobCodeSocket
      if (client.readyState === WS_OPEN && client.sessionId === sessionId && (audience === 'all' || client.isAuthenticatedManager === true)) {
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
    client.isAuthenticatedManager = false
    client.instructorPasscode = null
    if (client.sessionId) {
      cancelLiveGroupCleanup(client.sessionId)
      ensureBroadcastSubscription(client.sessionId)
    }

    client.on('message', (rawData) => {
      const msg = parseWsMessage(rawData)
      if (!msg || !client.sessionId) return
      const sessionId = client.sessionId
      cancelLiveGroupCleanup(sessionId)
      if (msg.type === 'manager-auth') {
        if (client.mobCodeRole !== 'manager') return
        const instructorPasscode = readWsInstructorPasscode(msg)
        if (!instructorPasscode) return
        client.instructorPasscode = instructorPasscode
        ;(async () => {
          const session = asMobCodeSession(await sessions.get(sessionId))
          if (!session || !verifyPasscode(session.data.instructorPasscode, instructorPasscode)) {
            console.warn(JSON.stringify({ event: 'mobcode.ws-manager-auth-denied', sessionId }))
            return
          }
          client.isAuthenticatedManager = true
        })().catch((error) => {
          console.error(JSON.stringify({ event: 'mobcode.ws-manager-auth-failed', sessionId, error: String(error) }))
        })
        return
      }
      if (
        msg.type !== 'file-content-update' &&
        msg.type !== 'active-file-changed' &&
        msg.type !== 'editor-presence-update'
      ) return
      if (client.mobCodeRole !== 'manager' || !client.instructorPasscode) return

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
        liveGroupsBySession.set(sessionId, nextGroup)

        const outgoing = JSON.stringify({ ...relayMessage, timestamp: Date.now() })
        for (const rawPeer of ws.wss.clients) {
          const peer = rawPeer as MobCodeSocket
          if (
            peer !== client
            && peer.readyState === WS_OPEN
            && peer.sessionId === sessionId
            && (session.data.studentCode?.shareChangesEnabled === true || peer.isAuthenticatedManager === true)
          ) {
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

    client.on('close', () => {
      if (!client.sessionId) return
      scheduleLiveGroupCleanup(client.sessionId)
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

  app.post('/api/mobcode/create-solo', async (req, res) => {
    try {
      const body = isPlainObject(req.body) ? req.body : {}
      const files = normalizeFiles(body.files)
      const activeFile = resolveActiveFile(files, body.activeFile)
      const runnerId = isMobCodeRunnerId(body.runnerId) ? body.runnerId : undefined
      const soloEditToken = createSoloEditToken()
      const session = await createSession(sessions, {
        data: normalizeMobCodeSessionData({
          groups: { [DEFAULT_GROUP_ID]: { files, activeFile } },
          soloMode: true,
          soloEditToken,
          ...(runnerId ? { embeddedLaunch: { selectedOptions: { runnerId } } } : {}),
        }),
      })
      session.type = 'mobcode'
      await sessions.set(session.id, session)
      console.info(JSON.stringify({ event: 'mobcode.solo-session-created', sessionId: session.id, fileCount: Object.keys(files).length }))
      res.cookie(getSoloEditCookieName(session.id), soloEditToken, {
        httpOnly: true,
        maxAge: SOLO_EDIT_COOKIE_MAX_AGE_MS,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: `/api/mobcode/${encodeURIComponent(session.id)}`,
      })
      res.set('Cache-Control', 'no-store')
      res.json({ id: session.id, soloEditToken })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.solo-create-failed', error: String(error) }))
      res.status(500).json({ error: 'Failed to create solo session' })
    }
  })

  app.get('/api/mobcode/:sessionId/session', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.set('Cache-Control', 'no-store')
      res.json({
        id: session.id,
        type: session.type,
        data: {
          groups: session.data.groups,
          runnerId: readEmbeddedRunnerId(session.data),
          soloMode: session.data.soloMode === true,
          canEditSolo: session.data.soloMode === true
            && verifyPasscode(session.data.soloEditToken, readRequestCookie(req, getSoloEditCookieName(session.id))),
        },
      })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.fetch-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to fetch session' })
    }
  })

  app.post('/api/mobcode/:sessionId/student-workspace', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      if (!session || session.data.soloMode === true) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const identity = resolveStudentIdentity(session, readRequestCookie(req, getSessionParticipantCookieName(session.id)))
      if (!identity) {
        console.warn(JSON.stringify({ event: 'mobcode.student-workspace-denied', sessionId: req.params.sessionId, reason: 'unaccepted-participant' }))
        res.status(403).json({ error: 'Waiting-room identity required' })
        return
      }
      const workspace = createStudentWorkspace(session.data, identity)
      if (workspace) {
        await sessions.set(session.id, session)
        await broadcast('student-code-updated', session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }, session.id, 'managers')
      }
      res.set('Cache-Control', 'no-store')
      res.json({ id: session.id, type: session.type, data: buildMobCodeStudentSnapshot(session.data, identity.participantId) })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.student-workspace-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to open student workspace' })
    }
  })

  app.post('/api/mobcode/:sessionId/manager-session', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      const body = isPlainObject(req.body) ? req.body : {}
      if (!session || !verifyPasscode(session.data.instructorPasscode, body.instructorPasscode)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      res.set('Cache-Control', 'no-store')
      res.json({ id: session.id, type: session.type, data: buildMobCodeManagerSnapshot(session.data) })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.manager-session-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to fetch manager session' })
    }
  })

  app.post('/api/mobcode/:sessionId/student-workspace/state', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      const body = isPlainObject(req.body) ? req.body : {}
      const identity = session ? resolveStudentIdentity(session, readRequestCookie(req, getSessionParticipantCookieName(session.id))) : null
      if (!session || !identity || session.data.soloMode === true) {
        console.warn(JSON.stringify({ event: 'mobcode.student-state-denied', sessionId: req.params.sessionId, reason: 'unaccepted-participant' }))
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      if (session.data.studentCode?.tryItEnabled !== true) {
        console.warn(JSON.stringify({ event: 'mobcode.student-state-denied', sessionId: session.id, participantId: identity.participantId, reason: 'try-it-disabled' }))
        res.status(423).json({ error: 'Student editing is locked' })
        return
      }
      const payload = readStatePayload(body)
      if (!payload) {
        res.status(400).json({ error: 'Invalid state payload' })
        return
      }
      const workspace = replaceStudentWorkspace(session.data, identity, normalizeGroupState(payload, MAX_STUDENT_WORKSPACE_BYTES))
      if (!workspace) {
        res.status(409).json({ error: 'Student code is not available yet' })
        return
      }
      await sessions.set(session.id, session)
      await broadcast('student-code-updated', session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }, session.id, 'managers')
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true, workspace: { files: workspace.files, activeFile: workspace.activeFile } })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.student-state-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to update student workspace' })
    }
  })

  app.post('/api/mobcode/:sessionId/student-workspace/reset', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      const identity = session ? resolveStudentIdentity(session, readRequestCookie(req, getSessionParticipantCookieName(session.id))) : null
      if (!session || !identity || session.data.soloMode === true) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      if (session.data.studentCode?.tryItEnabled !== true) {
        console.warn(JSON.stringify({
          event: 'mobcode.student-reset-denied',
          sessionId: session.id,
          reason: 'try-it-disabled',
        }))
        res.status(423).json({ error: 'Student editing is locked' })
        return
      }
      const starter = session.data.studentCode?.starterVersion
      if (!starter) {
        res.status(409).json({ error: 'No shared starter version is available' })
        return
      }
      const workspace = replaceStudentWorkspace(session.data, identity, normalizeGroupState(starter, MAX_STUDENT_WORKSPACE_BYTES))
      if (!workspace) {
        res.status(409).json({ error: 'Student code is not available yet' })
        return
      }
      await sessions.set(session.id, session)
      await broadcast('student-code-updated', session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }, session.id, 'managers')
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true, workspace: { files: workspace.files, activeFile: workspace.activeFile } })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.student-reset-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to reset student workspace' })
    }
  })

  app.post('/api/mobcode/:sessionId/student-code/:action', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      const body = isPlainObject(req.body) ? req.body : {}
      if (!session || !verifyPasscode(session.data.instructorPasscode, body.instructorPasscode)) {
        console.warn(JSON.stringify({ event: 'mobcode.student-code-manager-denied', sessionId: req.params.sessionId }))
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      const action = readParam(req.params.action)
      const studentCode = session.data.studentCode
      if (!studentCode) {
        res.status(409).json({ error: 'Student code is unavailable' })
        return
      }
      if (action === 'try-it') {
        studentCode.tryItEnabled = body.enabled === true
        if (studentCode.tryItEnabled && !studentCode.starterVersion) {
          studentCode.starterVersion = normalizeGroupState(
            session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' },
            MAX_STUDENT_WORKSPACE_BYTES,
          )
        }
      } else if (action === 'share-changes') {
        studentCode.shareChangesEnabled = body.enabled === true
        if (studentCode.shareChangesEnabled) {
          const currentInstructorWorkspace = session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }
          studentCode.starterVersion = normalizeGroupState(currentInstructorWorkspace, MAX_STUDENT_WORKSPACE_BYTES)
          studentCode.publishedInstructorVersion = cloneGroupState(currentInstructorWorkspace)
        }
      } else if (action === 'share-example') {
        const participantId = typeof body.participantId === 'string' ? body.participantId : ''
        const source = isValidParticipantId(participantId) && Object.hasOwn(studentCode.studentWorkspaces, participantId)
          ? studentCode.studentWorkspaces[participantId]
          : null
        if (!source) {
          res.status(404).json({ error: 'Student workspace not found' })
          return
        }
        studentCode.sharedExample = { sourceParticipantId: participantId, workspace: cloneGroupState(source), sharedAt: Date.now() }
      } else if (action === 'unshare-example') {
        studentCode.sharedExample = null
      } else {
        res.status(400).json({ error: 'Unsupported student code action' })
        return
      }
      await sessions.set(session.id, session)
      const settingsPayload = {
        ...(studentCode.shareChangesEnabled || !studentCode.publishedInstructorVersion
          ? session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }
          : studentCode.publishedInstructorVersion),
        tryItEnabled: studentCode.tryItEnabled,
        shareChangesEnabled: studentCode.shareChangesEnabled,
      }
      await broadcast('student-code-settings-changed', settingsPayload, session.id)
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true, data: buildMobCodeManagerSnapshot(session.data) })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.student-code-manager-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to update student code settings' })
    }
  })

  app.post('/api/mobcode/:sessionId/shared-workspace/state', async (req, res) => {
    try {
      const session = asMobCodeSession(await sessions.get(readParam(req.params.sessionId)))
      const body = isPlainObject(req.body) ? req.body : {}
      if (!session || !verifyPasscode(session.data.instructorPasscode, body.instructorPasscode)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      const payload = readStatePayload(body)
      const sharedExample = session.data.studentCode?.sharedExample
      if (!payload || !sharedExample) {
        res.status(409).json({ error: 'Shared workspace is unavailable' })
        return
      }
      sharedExample.workspace = normalizeGroupState(payload, MAX_STUDENT_WORKSPACE_BYTES)
      sharedExample.sharedAt = Date.now()
      await sessions.set(session.id, session)
      const settingsPayload = {
        ...(session.data.studentCode?.shareChangesEnabled || !session.data.studentCode?.publishedInstructorVersion
          ? session.data.groups[DEFAULT_GROUP_ID] ?? { files: {}, activeFile: '' }
          : session.data.studentCode.publishedInstructorVersion),
        tryItEnabled: session.data.studentCode?.tryItEnabled === true,
        shareChangesEnabled: session.data.studentCode?.shareChangesEnabled === true,
      }
      await broadcast('student-code-settings-changed', settingsPayload, session.id)
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true, workspace: sharedExample.workspace })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.shared-workspace-state-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to update shared workspace' })
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
      const hasInstructorAccess = verifyPasscode(session.data.instructorPasscode, body.instructorPasscode)
      const hasSoloEditAccess = session.data.soloMode === true
        && (
          verifyPasscode(session.data.soloEditToken, body.soloEditToken)
          || verifyPasscode(session.data.soloEditToken, readRequestCookie(req, getSoloEditCookieName(session.id)))
        )
      if (!hasInstructorAccess && !hasSoloEditAccess) {
        console.warn(JSON.stringify({ event: 'mobcode.state-denied', sessionId: session.id }))
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const payload = readStatePayload(body)
      if (!payload) {
        res.status(400).json({ error: 'Invalid state payload' })
        return
      }

      const messageType = readDurableMessageType(body.messageType)
      const currentLiveGroup = liveGroupsBySession.get(session.id)
      const nextPayload = resolveDurableStatePayload(
        messageType,
        payload,
        currentLiveGroup,
        hasOpenManagerSessionClients(
          ws.wss.clients as Iterable<SessionScopedWsClient>,
          session.id,
          session.data.instructorPasscode,
        ),
      )
      session.data.groups[DEFAULT_GROUP_ID] = nextPayload
      if (nextPayload !== currentLiveGroup) {
        liveGroupsBySession.set(session.id, nextPayload)
      }
      const shareChangesEnabled = session.data.studentCode?.shareChangesEnabled === true
      if (shareChangesEnabled) {
        session.data.studentCode!.publishedInstructorVersion = cloneGroupState(nextPayload)
      }
      await sessions.set(session.id, session)
      await broadcast(messageType, nextPayload, session.id, shareChangesEnabled ? 'all' : 'managers')
      if (session.data.soloMode === true) {
        scheduleLiveGroupCleanup(session.id)
      }
      res.set('Cache-Control', 'no-store')
      res.json({ ok: true })
    } catch (error) {
      console.error(JSON.stringify({ event: 'mobcode.state-failed', sessionId: req.params.sessionId, error: String(error) }))
      res.status(500).json({ error: 'Failed to update state' })
    }
  })
}
