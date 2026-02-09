import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import setupGalleryWalkRoutes, { sanitizeName } from '../activities/gallery-walk/server/routes.js'
import { createSessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../types/websocket.js'
import { DEFAULT_NOTE_STYLE_ID, NOTE_STYLE_OPTIONS } from '../activities/gallery-walk/shared/noteStyles.js'

type WsStub = WsRouter

interface CreateSessionResponse {
  id?: string
  sessionId?: string
}

interface GalleryFeedbackResponse {
  ok: boolean
  feedback: {
    to: string
    fromNameSnapshot: string
    styleId: string
  }
  stats: {
    reviewees: Record<string, number>
    reviewers: Record<string, number>
  }
}

interface GalleryExportBundle {
  version: number
  feedback: unknown[]
  config: {
    title?: string
  }
}

interface SessionTitleResponse {
  ok: boolean
  title: string
}

interface FeedbackSnapshotResponse {
  config: {
    title?: string
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function createWsStub(): WsStub {
  return {
    register(_pathname, _handler) {},
    wss: {
      clients: new Set<ActiveBitsWebSocket>(),
      close() {},
    },
  }
}

async function startTestServer(): Promise<{
  app: express.Express
  sessions: ReturnType<typeof createSessionStore>
  ws: WsStub
  baseUrl: string
  close: () => Promise<void>
}> {
  const app = express()
  app.use(express.json())
  const sessions = createSessionStore(null, 60 * 1000)
  const ws = createWsStub()
  setupGalleryWalkRoutes(app, sessions, ws)

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine test server address')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await sessions.close?.()
  }

  return { app, sessions, ws, baseUrl, close }
}

async function createSession(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/gallery-walk/create`, {
    method: 'POST',
  })
  const body = await readJson<CreateSessionResponse>(res)
  const sessionId = body.id ?? body.sessionId
  if (!sessionId) {
    throw new Error('Gallery session create response missing session id')
  }
  return sessionId
}

void test('creates gallery-walk sessions with defaults', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)
  const session = await server.sessions.get(sessionId)
  assert.ok(session)
  assert.equal(session.type, 'gallery-walk')
  assert.equal((session.data as { stage?: string }).stage, 'gallery')
  assert.deepEqual((session.data as { feedback?: unknown[] }).feedback, [])
  assert.deepEqual((session.data as { reviewees?: Record<string, unknown> }).reviewees, {})
  assert.deepEqual((session.data as { reviewers?: Record<string, unknown> }).reviewers, {})
  assert.deepEqual((session.data as { stats?: { reviewees?: Record<string, unknown> } }).stats?.reviewees, {})
  assert.deepEqual((session.data as { stats?: { reviewers?: Record<string, unknown> } }).stats?.reviewers, {})
})

void test('submits feedback and tracks stats', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-1', name: 'Student One' }),
  })

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-1', name: 'Reviewer One' }),
  })

  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-1', reviewerId: 'rev-1', message: 'Great project!' }),
  })
  const feedbackBody = await readJson<GalleryFeedbackResponse>(feedbackRes)

  assert.equal(feedbackBody.ok, true)
  assert.equal(feedbackBody.feedback.to, 'stu-1')
  assert.equal(feedbackBody.feedback.fromNameSnapshot, 'Reviewer One')
  assert.equal(feedbackBody.feedback.styleId, DEFAULT_NOTE_STYLE_ID)
  assert.equal(feedbackBody.stats.reviewees['stu-1'], 1)
  assert.equal(feedbackBody.stats.reviewers['rev-1'], 1)

  const session = await server.sessions.get(sessionId)
  assert.ok(session)
  assert.equal((session.data as { feedback?: unknown[] }).feedback?.length, 1)
})

void test('exports and imports gallery walk data', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-2', name: 'Student Two', projectTitle: 'Project' }),
  })
  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-2', name: 'Reviewer Two' }),
  })
  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-2', reviewerId: 'rev-2', message: 'Nice job' }),
  })

  const exportRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/export`)
  const bundle = await readJson<GalleryExportBundle>(exportRes)
  assert.equal(bundle.version, 1)
  assert.equal(bundle.feedback.length, 1)
})

void test('updates session title metadata', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)
  const titleRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Showcase 2024' }),
  })
  const titleBody = await readJson<SessionTitleResponse>(titleRes)
  assert.equal(titleBody.ok, true)
  assert.equal(titleBody.title, 'Showcase 2024')

  const snapshotRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`)
  const snapshot = await readJson<FeedbackSnapshotResponse>(snapshotRes)
  assert.equal(snapshot.config.title, 'Showcase 2024')

  const exportRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/export`)
  const bundle = await readJson<GalleryExportBundle>(exportRes)
  assert.equal(bundle.config.title, 'Showcase 2024')
})

void test('allows reviewers to set sticky note styles', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-3', name: 'Student Three' }),
  })

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-3', name: 'Reviewer Three' }),
  })

  const styleId = NOTE_STYLE_OPTIONS[1]?.id
  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-3', reviewerId: 'rev-3', message: 'Love the visuals', styleId }),
  })
  const body = await readJson<GalleryFeedbackResponse>(feedbackRes)
  assert.equal(body.feedback.styleId, styleId)
})

void test('invalid note style falls back to default', async (t: TestContext) => {
  const server = await startTestServer()
  t.after(server.close)

  const sessionId = await createSession(server.baseUrl)

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-4', name: 'Student Four' }),
  })

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-4', name: 'Reviewer Four' }),
  })

  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-4', reviewerId: 'rev-4', message: 'Great progress', styleId: 'invalid' }),
  })
  const body = await readJson<GalleryFeedbackResponse>(feedbackRes)
  assert.equal(body.feedback.styleId, DEFAULT_NOTE_STYLE_ID)
})

void test('sanitizeName trims whitespace and enforces default max length', () => {
  const input = `   ${'a'.repeat(250)}   `
  const result = sanitizeName(input)
  assert.equal(result?.length, 200)
  assert.equal(result?.[0], 'a')
})

void test('sanitizeName respects custom max length', () => {
  const input = 'b'.repeat(2100)
  const result = sanitizeName(input, '', 2000)
  assert.equal(result?.length, 2000)
})

void test('sanitizeName falls back for empty or non-string input', () => {
  assert.equal(sanitizeName('   ', 'fallback'), 'fallback')
  assert.equal(sanitizeName('', 'fallback'), 'fallback')
  assert.equal(sanitizeName(null, 'fallback'), 'fallback')
  assert.equal(sanitizeName(undefined, 'fallback'), 'fallback')
  assert.equal(sanitizeName({ foo: 'bar' }, 'fallback'), 'fallback')
})

void test('sanitizeName preserves special characters', () => {
  const input = 'Line1\nLine2 ☺'
  assert.equal(sanitizeName(input), 'Line1\nLine2 ☺')
})
