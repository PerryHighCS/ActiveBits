import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { findAcceptedEntryParticipant } from 'activebits-server/core/acceptedEntryParticipants.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import {
  isPostboardReactionId,
  type PostboardFlag,
  type PostboardInstructorSnapshot,
  type PostboardPost,
  type PostboardPostStatus,
  type PostboardPrompt,
  type PostboardReactionCounts,
  type PostboardReactionId,
  type PostboardReactionState,
  type PostboardSessionData,
  type PostboardSettings,
  type PostboardStudentPost,
  type PostboardStudentSnapshot,
} from '../shared/types.js'
import { normalizeNoteStyleId } from '../../shared/noteStyles.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, unknown>
  headers?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface PostboardRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => void | Promise<void>

interface PostboardSession extends SessionRecord {
  type: 'postboard'
  data: PostboardSessionData
}

const ACTIVITY_ID = 'postboard'
const DEFAULT_PROMPT_ID = 'prompt-1'
const INSTRUCTOR_PASSCODE_BYTES = 16
const MAX_INSTRUCTOR_PASSCODE_LENGTH = 512
const MAX_PROMPT_LENGTH = 1000
const MAX_POST_TEXT_LENGTH = 1200
const MAX_FLAG_REASON_LENGTH = 240
const MAX_POSTS = 500
const MAX_FLAGS_PER_POST = 25
const WS_OPEN = 1

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function getBody(req: RouteRequest): Record<string, unknown> {
  return isPlainObject(req.body) ? req.body : {}
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function sanitizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const sanitized = sanitizeText(value, maxLength)
  return sanitized.length > 0 ? sanitized : undefined
}

function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeNullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function createId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

function createInstructorPasscode(): string {
  return randomBytes(INSTRUCTOR_PASSCODE_BYTES).toString('hex')
}

function normalizeInstructorPasscode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_INSTRUCTOR_PASSCODE_LENGTH ? trimmed : null
}

function verifyPasscode(expected: unknown, candidate: unknown): boolean {
  const normalizedExpected = normalizeInstructorPasscode(expected)
  const normalizedCandidate = normalizeInstructorPasscode(candidate)
  if (!normalizedExpected || !normalizedCandidate || normalizedExpected.length !== normalizedCandidate.length) {
    return false
  }

  const expectedBuffer = Buffer.from(normalizedExpected)
  const candidateBuffer = Buffer.from(normalizedCandidate)
  if (expectedBuffer.length === 0 || expectedBuffer.length !== candidateBuffer.length) {
    return false
  }

  try {
    return timingSafeEqual(expectedBuffer, candidateBuffer)
  } catch {
    return false
  }
}

function readInstructorPasscode(req: RouteRequest): string | null {
  const header = req.headers?.['x-instructor-passcode']
  if (typeof header === 'string') return normalizeInstructorPasscode(header)
  return normalizeInstructorPasscode(getBody(req).instructorPasscode)
}

function requireInstructor(session: PostboardSession, req: RouteRequest, res: JsonResponse): boolean {
  if (verifyPasscode(session.data.instructorPasscode, readInstructorPasscode(req))) {
    return true
  }
  res.status(403).json({ error: 'Valid instructorPasscode is required' })
  return false
}

function readSelectedOptions(source: Record<string, unknown>): Record<string, unknown> | null {
  if (isPlainObject(source.selectedOptions)) {
    return source.selectedOptions
  }
  if (isPlainObject(source.embeddedLaunch) && isPlainObject(source.embeddedLaunch.selectedOptions)) {
    return source.embeddedLaunch.selectedOptions
  }
  return null
}

function normalizeAutoApprove(value: unknown): boolean {
  return value === true || value === 'true'
}

function normalizePrompt(source: Record<string, unknown>, now = Date.now()): PostboardPrompt {
  const selectedOptions = readSelectedOptions(source)
  const promptSource = isPlainObject(source.prompt) ? source.prompt : null
  const selectedPrompt = sanitizeText(selectedOptions?.prompt, MAX_PROMPT_LENGTH)
  const rawPromptText = promptSource
    ? promptSource.text
    : (typeof source.prompt === 'string' ? source.prompt : selectedPrompt)
  const text = sanitizeText(rawPromptText, MAX_PROMPT_LENGTH)
  const createdAt = promptSource ? normalizeTimestamp(promptSource.createdAt, now) : now
  return {
    id: sanitizeText(promptSource?.id, 120) || DEFAULT_PROMPT_ID,
    text,
    createdAt,
    updatedAt: promptSource ? normalizeTimestamp(promptSource.updatedAt, createdAt) : createdAt,
  }
}

function normalizeSettings(source: Record<string, unknown>): PostboardSettings {
  const selectedOptions = readSelectedOptions(source)
  const settingsSource = isPlainObject(source.settings) ? source.settings : {}
  const autoApprove = settingsSource.autoApprove ?? source.autoApprove ?? selectedOptions?.autoApprove
  return {
    autoApprove: normalizeAutoApprove(autoApprove),
  }
}

function normalizePostStatus(value: unknown): PostboardPostStatus {
  return value === 'approved' || value === 'rejected' || value === 'deleted' ? value : 'pending'
}

function normalizeAuthorRole(value: unknown): 'student' | 'instructor' {
  return value === 'instructor' ? 'instructor' : 'student'
}

function normalizePosts(value: unknown, promptId: string): PostboardPost[] {
  if (!Array.isArray(value)) return []
  const posts: PostboardPost[] = []

  for (const entry of value) {
    if (!isPlainObject(entry)) continue
    const id = sanitizeText(entry.id, 120) || createId('post')
    const text = sanitizeText(entry.text, MAX_POST_TEXT_LENGTH)
    if (!text) continue
    const authorRole = normalizeAuthorRole(entry.authorRole)
    const status = normalizePostStatus(entry.status)
    const createdAt = normalizeTimestamp(entry.createdAt)
    const approvedAt = status === 'approved'
      ? normalizeNullableTimestamp(entry.approvedAt) ?? createdAt
      : normalizeNullableTimestamp(entry.approvedAt)
    const rejectedAt = status === 'rejected'
      ? normalizeNullableTimestamp(entry.rejectedAt) ?? createdAt
      : normalizeNullableTimestamp(entry.rejectedAt)
    const deletedAt = status === 'deleted'
      ? normalizeNullableTimestamp(entry.deletedAt) ?? createdAt
      : normalizeNullableTimestamp(entry.deletedAt)

    posts.push({
      id,
      promptId: sanitizeText(entry.promptId, 120) || promptId,
      authorId: sanitizeText(entry.authorId, 160) || (authorRole === 'instructor' ? 'instructor' : 'unknown-student'),
      authorName: sanitizeText(entry.authorName, 160) || (authorRole === 'instructor' ? 'Instructor' : 'Student'),
      authorRole,
      text,
      styleId: normalizeNoteStyleId(entry.styleId),
      createdAt,
      updatedAt: normalizeTimestamp(entry.updatedAt, createdAt),
      status,
      approvedAt,
      rejectedAt,
      deletedAt,
      hiddenAt: normalizeNullableTimestamp(entry.hiddenAt),
      order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : posts.length,
    })
  }

  return posts
    .slice(-MAX_POSTS)
    .map((post, index) => ({
      ...post,
      order: Number.isFinite(post.order) ? post.order : index,
    }))
}

function normalizeReactions(value: unknown, posts: readonly PostboardPost[]): PostboardReactionState {
  if (!isPlainObject(value)) return {}
  const validPostIds = new Set(posts.map((post) => post.id))
  const reactions: PostboardReactionState = {}

  for (const [postId, rawEntry] of Object.entries(value)) {
    if (!validPostIds.has(postId) || !isPlainObject(rawEntry) || !isPlainObject(rawEntry.byUser)) {
      continue
    }

    const byUser: Record<string, PostboardReactionId> = {}
    for (const [userId, reactionId] of Object.entries(rawEntry.byUser)) {
      const normalizedUserId = sanitizeText(userId, 160)
      if (normalizedUserId && isPostboardReactionId(reactionId)) {
        byUser[normalizedUserId] = reactionId
      }
    }
    if (Object.keys(byUser).length > 0) {
      reactions[postId] = { byUser }
    }
  }

  return reactions
}

function normalizeFlags(value: unknown, posts: readonly PostboardPost[]): Record<string, PostboardFlag[]> {
  if (!isPlainObject(value)) return {}
  const validPostIds = new Set(posts.map((post) => post.id))
  const flags: Record<string, PostboardFlag[]> = {}

  for (const [postId, rawFlags] of Object.entries(value)) {
    if (!validPostIds.has(postId) || !Array.isArray(rawFlags)) continue
    const normalizedFlags: PostboardFlag[] = []
    for (const rawFlag of rawFlags) {
      if (!isPlainObject(rawFlag)) continue
      const reason = sanitizeOptionalText(rawFlag.reason, MAX_FLAG_REASON_LENGTH)
      normalizedFlags.push({
        id: sanitizeText(rawFlag.id, 120) || createId('flag'),
        postId,
        flaggedBy: sanitizeText(rawFlag.flaggedBy, 160) || 'instructor',
        ...(reason ? { reason } : {}),
        createdAt: normalizeTimestamp(rawFlag.createdAt),
      })
      if (normalizedFlags.length >= MAX_FLAGS_PER_POST) break
    }
    if (normalizedFlags.length > 0) {
      flags[postId] = normalizedFlags
    }
  }

  return flags
}

export function normalizePostboardSessionData(data: unknown): PostboardSessionData {
  const source = isPlainObject(data) ? data : {}
  const prompt = normalizePrompt(source)
  const posts = normalizePosts(source.posts, prompt.id)
  const embeddedLaunch = isPlainObject(source.embeddedLaunch)
    ? { ...source.embeddedLaunch }
    : undefined

  return {
    ...source,
    mode: 'postboard',
    instructorPasscode: normalizeInstructorPasscode(source.instructorPasscode) ?? createInstructorPasscode(),
    prompt,
    settings: normalizeSettings(source),
    posts,
    reactions: normalizeReactions(source.reactions, posts),
    flags: normalizeFlags(source.flags, posts),
    ...(embeddedLaunch ? { embeddedLaunch } : {}),
  }
}

function asPostboardSession(session: SessionRecord | null): PostboardSession | null {
  if (!session || session.type !== ACTIVITY_ID) return null
  session.data = normalizePostboardSessionData(session.data)
  return session as PostboardSession
}

export function buildReactionCounts(reactions: PostboardReactionState): PostboardReactionCounts {
  const counts: PostboardReactionCounts = {}
  for (const [postId, entry] of Object.entries(reactions)) {
    const postCounts: Partial<Record<PostboardReactionId, number>> = {}
    for (const reactionId of Object.values(entry.byUser)) {
      postCounts[reactionId] = (postCounts[reactionId] ?? 0) + 1
    }
    counts[postId] = postCounts
  }
  return counts
}

export function buildViewerReactions(
  reactions: PostboardReactionState,
  viewerId: string | null,
): Record<string, PostboardReactionId> {
  const result: Record<string, PostboardReactionId> = {}
  if (!viewerId) return result
  for (const [postId, entry] of Object.entries(reactions)) {
    const reactionId = entry.byUser[viewerId]
    if (reactionId) result[postId] = reactionId
  }
  return result
}

function sortPostsForBoard(posts: readonly PostboardPost[]): PostboardPost[] {
  return [...posts].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.createdAt - right.createdAt
  })
}

export function buildInstructorSnapshot(session: PostboardSession): PostboardInstructorSnapshot {
  return {
    prompt: session.data.prompt,
    settings: session.data.settings,
    posts: sortPostsForBoard(session.data.posts),
    reactionCounts: buildReactionCounts(session.data.reactions),
    viewerReactions: buildViewerReactions(session.data.reactions, 'instructor'),
    flags: session.data.flags,
  }
}

function toStudentPost(post: PostboardPost, viewerStudentId: string | null): PostboardStudentPost {
  return {
    id: post.id,
    promptId: post.promptId,
    authorRole: post.authorRole,
    authorLabel: post.authorRole === 'instructor' ? 'Instructor' : 'Student',
    text: post.text,
    styleId: post.styleId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    status: post.status,
    approvedAt: post.approvedAt,
    rejectedAt: post.rejectedAt,
    deletedAt: post.deletedAt,
    hiddenAt: post.hiddenAt,
    order: post.order,
    isOwnPost: viewerStudentId != null && post.authorId === viewerStudentId,
  }
}

export function buildStudentSnapshot(session: PostboardSession, viewerStudentId: string | null): PostboardStudentSnapshot {
  const visiblePosts = session.data.posts.filter((post) => {
    if (post.status === 'approved' && post.hiddenAt == null) return true
    return viewerStudentId != null && (post.status === 'pending' || post.status === 'rejected') && post.authorId === viewerStudentId
  })
  const visiblePostIds = new Set(visiblePosts.map((post) => post.id))
  const visibleReactions: PostboardReactionState = {}
  for (const [postId, entry] of Object.entries(session.data.reactions)) {
    if (visiblePostIds.has(postId)) {
      visibleReactions[postId] = entry
    }
  }

  return {
    prompt: session.data.prompt,
    settings: {
      autoApprove: session.data.settings.autoApprove,
    },
    posts: sortPostsForBoard(visiblePosts).map((post) => toStudentPost(post, viewerStudentId)),
    ownRejectedPosts: [],
    reactionCounts: buildReactionCounts(visibleReactions),
    viewerReactions: buildViewerReactions(visibleReactions, viewerStudentId),
  }
}

function readStudentId(req: RouteRequest): string | null {
  const body = getBody(req)
  const value = body.studentId ?? req.query?.studentId
  const studentId = sanitizeText(value, 160)
  return studentId || null
}

function resolveStudentName(session: PostboardSession, studentId: string, body: Record<string, unknown>): string {
  const accepted = findAcceptedEntryParticipant(session, studentId)
  return accepted?.displayName ?? (sanitizeText(body.studentName, 160) || 'Student')
}

function readSessionId(req: RouteRequest): string | null {
  return sanitizeText(req.params.sessionId, 160) || null
}

async function getPostboardSession(req: RouteRequest, res: JsonResponse, sessions: SessionStore): Promise<PostboardSession | null> {
  const sessionId = readSessionId(req)
  if (!sessionId) {
    res.status(400).json({ error: 'missing sessionId' })
    return null
  }
  const session = asPostboardSession(await sessions.get(sessionId))
  if (!session) {
    res.status(404).json({ error: 'invalid session' })
    return null
  }
  return session
}

function findPost(session: PostboardSession, postId: string | undefined): PostboardPost | null {
  const normalizedPostId = sanitizeText(postId, 160)
  return session.data.posts.find((post) => post.id === normalizedPostId) ?? null
}

function sendBroadcast(ws: WsRouter, sessionId: string): void {
  const payload = JSON.stringify({ type: 'postboard:updated', sessionId })
  for (const socket of ws.wss.clients as Set<ActiveBitsWebSocket>) {
    if (socket.readyState === WS_OPEN && socket.sessionId === sessionId) {
      socket.send(payload)
    }
  }
}

async function persistAndBroadcast(sessions: SessionStore, ws: WsRouter, session: PostboardSession): Promise<void> {
  await sessions.set(session.id, session)
  sendBroadcast(ws, session.id)
}

function logModeration(action: string, details: Record<string, unknown>): void {
  console.info('[postboard] moderation action', { action, ...details })
}

function routeHandler(name: string, handler: RouteHandler): RouteHandler {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      console.error('[postboard] Route failed', { route: name, error })
      res.status(500).json({ error: 'internal server error' })
    }
  }
}

registerSessionNormalizer(ACTIVITY_ID, (session) => {
  session.data = normalizePostboardSessionData(session.data)
})

export default function setupPostboardRoutes(app: PostboardRouteApp, sessions: SessionStore, ws: WsRouter): void {
  app.post('/api/postboard/create', routeHandler('create', async (req, res) => {
    const body = getBody(req)
    const selectedOptions = isPlainObject(body.selectedOptions) ? body.selectedOptions : {}
    const data = normalizePostboardSessionData({ selectedOptions })
    const session = await createSession(sessions, { data })
    session.type = ACTIVITY_ID
    session.data = data
    await sessions.set(session.id, session)
    res.json({ id: session.id, instructorPasscode: data.instructorPasscode })
  }))

  app.get('/api/postboard/:sessionId/instructor-state', routeHandler('instructor-state', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    res.json(buildInstructorSnapshot(session))
  }))

  app.get('/api/postboard/:sessionId/student-state', routeHandler('student-state', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session) return
    res.json(buildStudentSnapshot(session, readStudentId(req)))
  }))

  app.post('/api/postboard/:sessionId/setup', routeHandler('setup', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const body = getBody(req)
    const promptText = sanitizeText(body.prompt, MAX_PROMPT_LENGTH)
    const now = Date.now()
    session.data.prompt = {
      ...session.data.prompt,
      text: promptText,
      updatedAt: now,
    }
    session.data.settings = {
      autoApprove: normalizeAutoApprove(body.autoApprove),
    }
    await persistAndBroadcast(sessions, ws, session)
    logModeration('setup', { sessionId: session.id, autoApprove: session.data.settings.autoApprove })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts', routeHandler('posts', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session) return
    const body = getBody(req)
    const text = sanitizeText(body.text, MAX_POST_TEXT_LENGTH)
    if (!text) {
      res.status(400).json({ error: 'post text is required' })
      return
    }

    const instructorPasscode = readInstructorPasscode(req)
    const isInstructor = verifyPasscode(session.data.instructorPasscode, instructorPasscode)
    const studentId = readStudentId(req)
    if (!isInstructor && !studentId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }
    if (session.data.posts.length >= MAX_POSTS) {
      res.status(409).json({ error: 'post limit reached' })
      return
    }

    const now = Date.now()
    const status: PostboardPostStatus = isInstructor || session.data.settings.autoApprove ? 'approved' : 'pending'
    const post: PostboardPost = {
      id: createId('post'),
      promptId: session.data.prompt.id,
      authorId: isInstructor ? 'instructor' : studentId as string,
      authorName: isInstructor ? 'Instructor' : resolveStudentName(session, studentId as string, body),
      authorRole: isInstructor ? 'instructor' : 'student',
      text,
      styleId: normalizeNoteStyleId(body.styleId),
      createdAt: now,
      updatedAt: now,
      status,
      approvedAt: status === 'approved' ? now : null,
      rejectedAt: null,
      deletedAt: null,
      hiddenAt: null,
      order: session.data.posts.length,
    }

    session.data.posts.push(post)
    await persistAndBroadcast(sessions, ws, session)
    res.json({ post, instructor: isInstructor })
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/approve', routeHandler('approve', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const now = Date.now()
    post.status = 'approved'
    post.approvedAt = now
    post.rejectedAt = null
    post.deletedAt = null
    post.updatedAt = now
    await persistAndBroadcast(sessions, ws, session)
    logModeration('approve', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/reject', routeHandler('reject', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const now = Date.now()
    post.status = 'rejected'
    post.rejectedAt = now
    post.approvedAt = null
    post.deletedAt = null
    post.updatedAt = now
    await persistAndBroadcast(sessions, ws, session)
    logModeration('reject', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/unreject', routeHandler('unreject', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const now = Date.now()
    post.status = 'pending'
    post.rejectedAt = null
    post.deletedAt = null
    post.updatedAt = now
    await persistAndBroadcast(sessions, ws, session)
    logModeration('unreject', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/delete', routeHandler('delete', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const studentId = readStudentId(req)
    if (!studentId || post.authorId !== studentId || post.status !== 'rejected') {
      res.status(403).json({ error: 'cannot delete this post' })
      return
    }
    const now = Date.now()
    post.status = 'deleted'
    post.deletedAt = now
    post.updatedAt = now
    await persistAndBroadcast(sessions, ws, session)
    logModeration('delete', { sessionId: session.id, postId: post.id })
    res.json(buildStudentSnapshot(session, studentId))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/hide', routeHandler('hide', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    post.hiddenAt = Date.now()
    post.updatedAt = post.hiddenAt
    await persistAndBroadcast(sessions, ws, session)
    logModeration('hide', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/unhide', routeHandler('unhide', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    post.hiddenAt = null
    post.updatedAt = Date.now()
    await persistAndBroadcast(sessions, ws, session)
    logModeration('unhide', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/reorder', routeHandler('reorder', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const body = getBody(req)
    const postIds = Array.isArray(body.postIds) ? body.postIds.filter((entry): entry is string => typeof entry === 'string') : []
    const orderById = new Map(postIds.map((postId, index) => [postId, index]))
    for (const post of session.data.posts) {
      const nextOrder = orderById.get(post.id)
      if (nextOrder != null) {
        post.order = nextOrder
      }
    }
    await persistAndBroadcast(sessions, ws, session)
    logModeration('reorder', { sessionId: session.id, count: orderById.size })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/flag', routeHandler('flag', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session || !requireInstructor(session, req, res)) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const body = getBody(req)
    const reason = sanitizeOptionalText(body.reason, MAX_FLAG_REASON_LENGTH)
    const isCurrentlyFlagged = (session.data.flags[post.id]?.length ?? 0) > 0
    const shouldFlag = typeof body.flagged === 'boolean' ? body.flagged : !isCurrentlyFlagged

    if (shouldFlag) {
      const flag: PostboardFlag = {
        id: createId('flag'),
        postId: post.id,
        flaggedBy: 'instructor',
        ...(reason ? { reason } : {}),
        createdAt: Date.now(),
      }
      session.data.flags[post.id] = [flag]
    } else {
      delete session.data.flags[post.id]
    }
    await persistAndBroadcast(sessions, ws, session)
    logModeration(shouldFlag ? 'flag' : 'unflag', { sessionId: session.id, postId: post.id })
    res.json(buildInstructorSnapshot(session))
  }))

  app.post('/api/postboard/:sessionId/posts/:postId/react', routeHandler('react', async (req, res) => {
    const session = await getPostboardSession(req, res, sessions)
    if (!session) return
    const post = findPost(session, req.params.postId)
    if (!post) {
      res.status(404).json({ error: 'invalid post' })
      return
    }
    const body = getBody(req)
    const reactionId = body.reactionId
    if (reactionId != null && !isPostboardReactionId(reactionId)) {
      res.status(400).json({ error: 'invalid reactionId' })
      return
    }

    const isInstructor = verifyPasscode(session.data.instructorPasscode, readInstructorPasscode(req))
    const studentId = readStudentId(req)
    const reactorId = isInstructor ? 'instructor' : studentId
    if (!reactorId) {
      res.status(400).json({ error: 'studentId is required' })
      return
    }
    if (!isInstructor && (post.status !== 'approved' || post.hiddenAt != null || post.authorId === studentId)) {
      res.status(403).json({ error: 'cannot react to this post' })
      return
    }

    const reactionEntry = session.data.reactions[post.id] ?? { byUser: {} }
    session.data.reactions[post.id] = reactionEntry
    if (reactionId == null) {
      delete reactionEntry.byUser[reactorId]
    } else {
      reactionEntry.byUser[reactorId] = reactionId
    }
    if (Object.keys(reactionEntry.byUser).length === 0) {
      delete session.data.reactions[post.id]
    }
    const changedPostReactions: PostboardReactionState = {}
    const changedReactionEntry = session.data.reactions[post.id]
    if (changedReactionEntry) {
      changedPostReactions[post.id] = changedReactionEntry
    }
    const visibleReactionCountsSource: PostboardReactionState = {}
    if (!isInstructor) {
      const visiblePostIds = new Set(session.data.posts
        .filter((entry) => entry.status === 'approved' && entry.hiddenAt == null && entry.authorId !== studentId)
        .map((entry) => entry.id))
      for (const [reactionPostId, entry] of Object.entries(session.data.reactions)) {
        if (visiblePostIds.has(reactionPostId)) {
          visibleReactionCountsSource[reactionPostId] = entry
        }
      }
    }
    await persistAndBroadcast(sessions, ws, session)
    res.json({
      reactionCounts: buildReactionCounts(isInstructor ? session.data.reactions : visibleReactionCountsSource),
      viewerReactions: buildViewerReactions(changedPostReactions, reactorId),
    })
  }))
}
