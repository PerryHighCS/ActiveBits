import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import { normalizeNoteStyleId } from '../shared/noteStyles.js'
import { generateShortId } from '../shared/id.js'

const DEFAULT_STAGE = 'gallery'
const MAX_ID_ATTEMPTS = 5

type GalleryStage = 'gallery' | 'review'

interface RevieweeRecord {
  name: string
  projectTitle?: string | null
}

interface ReviewerRecord {
  name: string
}

interface FeedbackEntry {
  id: string
  to: string
  from: string
  fromNameSnapshot: string
  message: string
  createdAt: number
  styleId: string
}

interface GalleryStats {
  reviewees: Record<string, number>
  reviewers: Record<string, number>
}

interface GalleryWalkSessionData extends Record<string, unknown> {
  stage: GalleryStage
  config: Record<string, unknown>
  reviewees: Record<string, RevieweeRecord>
  reviewers: Record<string, ReviewerRecord>
  feedback: FeedbackEntry[]
  stats: GalleryStats
}

interface GalleryWalkSession extends SessionRecord {
  type?: string
  data: GalleryWalkSessionData
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface GalleryWalkRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface GalleryWalkSocket extends ActiveBitsWebSocket {
  sessionId?: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function normalizeStage(stage: unknown): GalleryStage {
  return stage === 'review' ? 'review' : DEFAULT_STAGE
}

function normalizeCountRecord(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) return {}

  const normalized: Record<string, number> = {}
  for (const [key, rawCount] of Object.entries(value)) {
    if (typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0) {
      normalized[key] = rawCount
    }
  }

  return normalized
}

function normalizeReviewees(value: unknown): Record<string, RevieweeRecord> {
  if (!isPlainObject(value)) return {}

  const reviewees: Record<string, RevieweeRecord> = {}
  for (const [id, rawReviewee] of Object.entries(value)) {
    const reviewee = ensurePlainObject(rawReviewee)
    const name = sanitizeName(reviewee.name)
    if (!name) continue

    const projectTitle = sanitizeName(reviewee.projectTitle, null)
    reviewees[id] = projectTitle ? { name, projectTitle } : { name }
  }

  return reviewees
}

function normalizeReviewers(value: unknown): Record<string, ReviewerRecord> {
  if (!isPlainObject(value)) return {}

  const reviewers: Record<string, ReviewerRecord> = {}
  for (const [id, rawReviewer] of Object.entries(value)) {
    const reviewer = ensurePlainObject(rawReviewer)
    const name = sanitizeName(reviewer.name)
    if (!name) continue
    reviewers[id] = { name }
  }

  return reviewers
}

function normalizeFeedbackEntries(value: unknown): FeedbackEntry[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => ensurePlainObject(entry))
    .map((entry) => {
      const to = sanitizeName(entry.to)
      const from = sanitizeName(entry.from)
      const message = sanitizeName(entry.message, '', 2000) || ''
      return {
        id: sanitizeName(entry.id) || generateShortId(),
        to: to || '',
        from: from || '',
        fromNameSnapshot: sanitizeName(entry.fromNameSnapshot, 'Anonymous Reviewer') || 'Anonymous Reviewer',
        message,
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
        styleId: normalizeNoteStyleId(entry.styleId),
      }
    })
    .filter((entry) => Boolean(entry.to && entry.from && entry.message))
}

function normalizeSessionData(data: unknown): GalleryWalkSessionData {
  const source = ensurePlainObject(data)
  const statsSource = ensurePlainObject(source.stats)

  return {
    ...source,
    stage: normalizeStage(source.stage),
    config: ensurePlainObject(source.config),
    reviewees: normalizeReviewees(source.reviewees),
    reviewers: normalizeReviewers(source.reviewers),
    feedback: normalizeFeedbackEntries(source.feedback),
    stats: {
      reviewees: normalizeCountRecord(statsSource.reviewees),
      reviewers: normalizeCountRecord(statsSource.reviewers),
    },
  }
}

function asGalleryWalkSession(session: SessionRecord | null): GalleryWalkSession | null {
  if (!session || session.type !== 'gallery-walk') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as GalleryWalkSession
}

export function sanitizeName(value: unknown, fallback: string | null = '', maxLength = 200): string | null {
  if (!value || typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

registerSessionNormalizer('gallery-walk', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupGalleryWalkRoutes(app: GalleryWalkRouteApp, sessions: SessionStore, ws: WsRouter): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const message = { type, payload }
    const serialized = JSON.stringify(message)

    if (sessions.publishBroadcast) {
      try {
        await sessions.publishBroadcast(`session:${sessionId}:broadcast`, message as Record<string, unknown>)
      } catch (err) {
        console.error('Failed to publish gallery-walk broadcast', err)
      }
    }

    const clients = ws.wss.clients || new Set<ActiveBitsWebSocket>()
    for (const socket of clients as Set<GalleryWalkSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(serialized)
        } catch (err) {
          console.error('Failed to send gallery-walk broadcast', err)
        }
      }
    }
  }

  ws.register('/ws/gallery-walk', (socket, queryParams) => {
    const client = socket as GalleryWalkSocket
    client.sessionId = queryParams.get('sessionId') || null
    ensureBroadcastSubscription(client.sessionId)
  })

  app.post('/api/gallery-walk/create', async (_req, res) => {
    const session = await createSession(sessions, {
      data: {
        stage: DEFAULT_STAGE,
        config: {},
        reviewees: {},
        reviewers: {},
        feedback: [],
        stats: { reviewees: {}, reviewers: {} },
      },
    })

    session.type = 'gallery-walk'
    session.data = normalizeSessionData(session.data)
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    res.json({ id: session.id, sessionId: session.id })
  })

  app.post('/api/gallery-walk/:sessionId/stage', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = ensurePlainObject(req.body)
    const requestedStage = normalizeStage(body.stage)
    session.data.stage = requestedStage
    await sessions.set(session.id, session)
    await broadcast('stage-changed', { stage: requestedStage }, session.id)

    res.json({ ok: true, stage: requestedStage })
  })

  app.post('/api/gallery-walk/:sessionId/reviewee', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = ensurePlainObject(req.body)
    const providedIdRaw = typeof body.revieweeId === 'string' ? body.revieweeId.trim() : ''
    const providedId = /^[A-Z0-9]{6}$/i.test(providedIdRaw) ? providedIdRaw.toUpperCase() : ''
    let revieweeId = providedId || generateShortId()
    const name = sanitizeName(body.name)
    const projectTitle = sanitizeName(body.projectTitle, null)

    if (!revieweeId || !name) {
      res.status(400).json({ error: 'revieweeId and name are required' })
      return
    }

    if (session.data.reviewees[revieweeId]) {
      let attempts = 0
      do {
        revieweeId = generateShortId()
        attempts += 1
      } while (session.data.reviewees[revieweeId] && attempts < MAX_ID_ATTEMPTS)

      if (session.data.reviewees[revieweeId]) {
        res.status(409).json({ error: 'revieweeId already exists' })
        return
      }
    }

    session.data.reviewees[revieweeId] = projectTitle ? { name, projectTitle } : { name }
    await sessions.set(session.id, session)
    await broadcast('reviewees-updated', { reviewees: session.data.reviewees }, session.id)

    res.json({ ok: true, revieweeId, reviewees: session.data.reviewees })
  })

  app.post('/api/gallery-walk/:sessionId/reviewer', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = ensurePlainObject(req.body)
    const reviewerId = sanitizeName(body.reviewerId) || ''
    const name = sanitizeName(body.name)
    if (!reviewerId || !name) {
      res.status(400).json({ error: 'reviewerId and name are required' })
      return
    }

    session.data.reviewers[reviewerId] = { name }
    await sessions.set(session.id, session)
    res.json({ ok: true })
  })

  app.post('/api/gallery-walk/:sessionId/feedback', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = ensurePlainObject(req.body)
    const revieweeId = sanitizeName(body.revieweeId) || ''
    const reviewerId = sanitizeName(body.reviewerId) || ''
    const message = sanitizeName(body.message, '', 2000) || ''

    if (!revieweeId || !reviewerId || !message) {
      res.status(400).json({ error: 'revieweeId, reviewerId, and message are required' })
      return
    }

    const reviewer = session.data.reviewers[reviewerId]
    const styleId = normalizeNoteStyleId(body.styleId)
    const feedbackEntry: FeedbackEntry = {
      id: generateShortId(),
      to: revieweeId,
      from: reviewerId,
      fromNameSnapshot: reviewer?.name || 'Anonymous Reviewer',
      message,
      createdAt: Date.now(),
      styleId,
    }

    session.data.feedback.push(feedbackEntry)
    session.data.stats.reviewees[revieweeId] = (session.data.stats.reviewees[revieweeId] || 0) + 1
    session.data.stats.reviewers[reviewerId] = (session.data.stats.reviewers[reviewerId] || 0) + 1

    await sessions.set(session.id, session)
    await broadcast('feedback-added', { feedback: feedbackEntry }, session.id)

    res.json({ ok: true, feedback: feedbackEntry, stats: session.data.stats })
  })

  app.get('/api/gallery-walk/:sessionId/feedback', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({
      feedback: session.data.feedback,
      reviewees: session.data.reviewees,
      reviewers: session.data.reviewers,
      stats: session.data.stats,
      stage: session.data.stage,
      config: session.data.config,
    })
  })

  app.get('/api/gallery-walk/:sessionId/feedback/:revieweeId', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const revieweeId = req.params.revieweeId
    if (!revieweeId) {
      res.status(400).json({ error: 'revieweeId required' })
      return
    }

    const filtered = session.data.feedback.filter((entry) => entry.to === revieweeId)
    res.json({
      feedback: filtered,
      reviewee: session.data.reviewees[revieweeId] || null,
      reviewers: session.data.reviewers,
      stage: session.data.stage,
      config: session.data.config,
    })
  })

  app.get('/api/gallery-walk/:sessionId/export', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const bundle = {
      version: 1,
      exportedAt: Date.now(),
      sessionId: session.id,
      reviewees: session.data.reviewees,
      reviewers: session.data.reviewers,
      feedback: session.data.feedback,
      stats: session.data.stats,
      stage: session.data.stage,
      config: session.data.config,
    }

    res.json(bundle)
  })

  app.post('/api/gallery-walk/:sessionId/title', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asGalleryWalkSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = ensurePlainObject(req.body)
    const title = sanitizeName(body.title || '', '', 200) || ''
    session.data.config = ensurePlainObject(session.data.config)
    session.data.config.title = title
    await sessions.set(session.id, session)
    res.json({ ok: true, title })
  })
}
