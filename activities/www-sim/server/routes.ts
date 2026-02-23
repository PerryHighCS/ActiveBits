import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  FragmentAssignment,
  HostedFileAssignment,
  HostedFragmentRecord,
  PassageDefinition,
  StudentRecord,
  StudentTemplate,
  StudentTemplateMap,
  WwwSimSessionData,
} from '../wwwSimTypes.js'
import presetPassages from './presetPassages.js'
import { createHostingMap, generateHtmlTemplate, verifyHostname } from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface WwwSimRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  patch(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  delete(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  put(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface WwwSimSocket extends ActiveBitsWebSocket {
  hostname?: string | null
}

interface WwwSimSession extends SessionRecord {
  type?: string
  data: WwwSimSessionData
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function normalizeStudents(value: unknown): StudentRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((student): student is Record<string, unknown> => isPlainObject(student))
    .flatMap((student) => {
      const hostname = normalizeHostname(student.hostname)
      const joined = typeof student.joined === 'number' ? student.joined : Date.now()
      if (!hostname) return []
      return [{ hostname, joined }]
    })
}

function normalizeFragmentAssignments(value: unknown): FragmentAssignment[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((assignment): assignment is Record<string, unknown> => isPlainObject(assignment))
    .flatMap((assignment) => {
      const hostname = normalizeHostname(assignment.hostname)
      const fileName = typeof assignment.fileName === 'string' ? assignment.fileName : null
      if (!hostname || !fileName) return []
      return [{ hostname, fileName }]
    })
}

function normalizeHostedFragments(value: unknown): HostedFragmentRecord[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((fragment): fragment is Record<string, unknown> => isPlainObject(fragment))
    .flatMap((fragment, index) => {
      if (typeof fragment.fragment !== 'string' || typeof fragment.hash !== 'string') return []
      const assignedTo = normalizeFragmentAssignments(fragment.assignedTo)
      const resolvedIndex = typeof fragment.index === 'number' ? fragment.index : index
      return [
        {
          fragment: fragment.fragment,
          index: resolvedIndex,
          assignedTo,
          hash: fragment.hash,
        },
      ]
    })
}

function normalizeTemplate(value: unknown): StudentTemplate | null {
  if (!isPlainObject(value)) return null
  if (!Array.isArray(value.fragments)) return null

  const fragments = value.fragments
    .filter((fragment): fragment is Record<string, unknown> => isPlainObject(fragment))
    .flatMap((fragment) => {
      if (typeof fragment.hash !== 'string' || typeof fragment.url !== 'string') return []
      return [{ hash: fragment.hash, url: fragment.url }]
    })

  return {
    title: typeof value.title === 'string' ? value.title : undefined,
    fragments,
  }
}

function normalizeStudentTemplates(value: unknown): StudentTemplateMap {
  if (!isPlainObject(value)) return {}
  const entries = Object.entries(value).flatMap(([hostname, template]) => {
    const normalizedHostname = normalizeHostname(hostname)
    const normalizedTemplate = normalizeTemplate(template)
    if (!normalizedHostname || !normalizedTemplate) return []
    return [[normalizedHostname, normalizedTemplate] as const]
  })
  return Object.fromEntries(entries)
}

function normalizePassage(value: unknown): PassageDefinition | null {
  if (!isPlainObject(value) || typeof value.value !== 'string') return null

  const adjectives = Array.isArray(value.adjectives)
    ? value.adjectives.filter((word): word is string => typeof word === 'string')
    : undefined
  const nouns = Array.isArray(value.nouns) ? value.nouns.filter((word): word is string => typeof word === 'string') : undefined

  return {
    value: value.value,
    title: typeof value.title === 'string' ? value.title : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    adjectives,
    nouns,
  }
}

function normalizeSessionData(data: unknown): WwwSimSessionData {
  const source = isPlainObject(data) ? data : {}
  return {
    ...source,
    students: normalizeStudents(source.students),
    studentTemplates: normalizeStudentTemplates(source.studentTemplates),
    fragments: normalizeHostedFragments(source.fragments),
    passage: normalizePassage(source.passage) ?? undefined,
  }
}

function asWwwSimSession(session: SessionRecord | null): WwwSimSession | null {
  if (!session || session.type !== 'www-sim') return null
  session.data = normalizeSessionData(session.data)
  return session as WwwSimSession
}

registerSessionNormalizer('www-sim', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupWwwSimRoutes(app: WwwSimRouteApp, sessions: SessionStore, ws: WsRouter): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  ws.register('/ws/www-sim', (socket, query) => {
    const client = socket as WwwSimSocket
    client.sessionId = query.get('sessionId') || null
    if (client.sessionId) {
      ensureBroadcastSubscription(client.sessionId)
    }
    client.hostname = normalizeHostname(query.get('hostname'))
  })

  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const message = { type, payload }

    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, message as Record<string, unknown>)
    }

    const serialized = JSON.stringify(message)
    for (const socket of ws.wss.clients as Set<WwwSimSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(serialized)
        } catch {
          // Ignore socket send failures.
        }
      }
    }
  }

  async function sendFragmentAssignments(hostname: string, session: WwwSimSession): Promise<HostedFileAssignment[]> {
    const host: HostedFileAssignment[] = []
    for (const fragment of session.data.fragments) {
      for (const assignment of fragment.assignedTo) {
        if (assignment.hostname === hostname) {
          host.push({ fileName: assignment.fileName, fragment: fragment.fragment })
        }
      }
    }

    let requests = session.data.studentTemplates[hostname]
    if (!requests && session.data.fragments.length > 0) {
      requests = generateHtmlTemplate(hostname, session.data.fragments, session.data.passage?.title)
      session.data.studentTemplates[hostname] = requests
      await sessions.set(session.id, session)
      await broadcast('template-assigned', { hostname, template: requests }, session.id)
    }

    if (host.length > 0 || requests) {
      const message = JSON.stringify({
        type: 'assigned-fragments',
        payload: { host, requests: requests ?? null },
      })

      for (const socket of ws.wss.clients as Set<WwwSimSocket>) {
        if (socket.readyState === 1 && socket.sessionId === session.id && socket.hostname === hostname) {
          try {
            socket.send(message)
          } catch {
            // Ignore socket send failures.
          }
        }
      }
    }

    return host
  }

  app.get('/api/www-sim/passages', (_req, res) => {
    res.json(presetPassages)
  })

  app.post('/api/www-sim/create', async (_req, res) => {
    const session = await createSession(sessions, {
      data: { students: [], studentTemplates: {}, fragments: [] },
    })
    session.type = 'www-sim'
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    res.json({ id: session.id })
  })

  app.get('/api/www-sim/:id', async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({
      id: session.id,
      students: session.data.students,
      studentTemplates: session.data.studentTemplates,
      hostingMap: session.data.fragments,
      passage: session.data.passage,
    })
  })

  app.post('/api/www-sim/:id/join', async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const hostname = normalizeHostname(body.hostname)
    if (!hostname) {
      res.status(400).json({ error: 'hostname required' })
      return
    }
    if (!verifyHostname(hostname)) {
      res.status(400).json({ error: 'invalid hostname' })
      return
    }

    const now = Date.now()
    const existing = session.data.students.find((student) => student.hostname === hostname)
    if (existing) {
      existing.joined = now
    } else {
      session.data.students.push({ hostname, joined: now })
    }

    await sessions.set(session.id, session)
    await broadcast('student-joined', { hostname, joined: now }, session.id)
    res.json({ message: `Joined session as ${hostname}` })
    await sendFragmentAssignments(hostname, session)
  })

  app.patch('/api/www-sim/:id/students/:hostname', async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const currentHostname = normalizeHostname(req.params.hostname)
    if (!currentHostname) {
      res.status(404).json({ error: 'student not found' })
      return
    }

    const student = session.data.students.find((entry) => entry.hostname === currentHostname)
    if (!student) {
      res.status(404).json({ error: 'student not found' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const newHostname = normalizeHostname(body.newHostname)
    if (!newHostname) {
      res.status(400).json({ error: 'new hostname required' })
      return
    }
    if (!verifyHostname(newHostname)) {
      res.status(400).json({ error: 'invalid hostname' })
      return
    }
    if (newHostname === currentHostname) {
      res.status(200).json({ message: 'no change', students: session.data.students })
      return
    }
    if (session.data.students.some((entry) => entry.hostname === newHostname)) {
      res.status(409).json({ error: 'hostname already in use' })
      return
    }

    student.hostname = newHostname

    for (const socket of ws.wss.clients as Set<WwwSimSocket>) {
      if (socket.readyState === 1 && socket.sessionId === session.id && socket.hostname === currentHostname) {
        socket.hostname = newHostname
      }
    }

    const escaped = currentHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`//${escaped}/`, 'g')

    const updatedTemplates = Object.fromEntries(
      Object.entries(session.data.studentTemplates).map(([hostname, template]) => [
        hostname === currentHostname ? newHostname : hostname,
        {
          ...template,
          fragments: template.fragments.map((fragment) => ({
            ...fragment,
            url: fragment.url.replace(regex, `//${newHostname}/`),
          })),
        } satisfies StudentTemplate,
      ]),
    ) as StudentTemplateMap
    session.data.studentTemplates = updatedTemplates

    for (const fragment of session.data.fragments) {
      fragment.assignedTo = fragment.assignedTo.map((assignment) =>
        assignment.hostname === currentHostname ? { ...assignment, hostname: newHostname } : assignment,
      )
    }

    await sessions.set(session.id, session)
    await broadcast('student-updated', { oldHostname: currentHostname, newHostname }, session.id)
    res.json({ message: `Updated hostname to ${newHostname}`, students: session.data.students })
  })

  app.delete('/api/www-sim/:id/students/:hostname', async (req, res) => {
    const id = req.params.id
    const hostname = req.params.hostname
    if (!id || !hostname) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const index = session.data.students.findIndex((student) => student.hostname === hostname)
    if (index === -1) {
      res.status(404).json({ error: 'student not found' })
      return
    }

    const [removed] = session.data.students.splice(index, 1)
    if (!removed) {
      res.status(404).json({ error: 'student not found' })
      return
    }

    await sessions.set(session.id, session)
    await broadcast('student-removed', { hostname: removed.hostname }, session.id)
    res.json({ message: `Removed student ${removed.hostname}`, students: session.data.students })
  })

  app.post('/api/www-sim/:id/assign', async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const passage = normalizePassage(body.passage)
    if (!passage) {
      res.status(400).json({ error: 'invalid or missing passage' })
      return
    }

    if (session.data.fragments.length > 0 && Object.keys(session.data.studentTemplates).length > 0) {
      res.status(409).json({ error: 'hosting map and templates already assigned' })
      return
    }

    const hostingMap = createHostingMap(session.data.students, passage)
    const studentTemplates: StudentTemplateMap = {}
    for (const { hostname } of session.data.students) {
      studentTemplates[hostname] = generateHtmlTemplate(hostname, hostingMap, passage.title)
    }

    session.data.fragments = hostingMap
    session.data.studentTemplates = studentTemplates
    session.data.passage = passage

    await sessions.set(session.id, session)
    await broadcast('fragments-assigned', { studentTemplates, hostingMap }, session.id)

    for (const fragment of hostingMap) {
      for (const assignment of fragment.assignedTo) {
        await sendFragmentAssignments(assignment.hostname, session)
      }
    }

    res.json({ message: 'Fragments assigned' })
  })

  app.put('/api/www-sim/:id/assign', async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const hostname = normalizeHostname(body.hostname)
    const template = normalizeTemplate(body.template)
    if (!hostname || !template) {
      res.status(400).json({ error: 'hostname and template required' })
      return
    }

    if (session.data.studentTemplates[hostname]) {
      res.status(409).json({ error: 'template already assigned to this hostname' })
      return
    }

    session.data.studentTemplates[hostname] = template
    await sessions.set(session.id, session)
    await broadcast('template-assigned', { hostname, template }, session.id)
    res.json({ message: 'Template assigned' })
  })

  app.get('/api/www-sim/:id/fragments/:hostname', async (req, res) => {
    const id = req.params.id
    const hostname = req.params.hostname
    if (!id || !hostname) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asWwwSimSession(await sessions.get(id))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const host: HostedFileAssignment[] = []
    for (const fragment of session.data.fragments) {
      for (const assignment of fragment.assignedTo) {
        if (assignment.hostname === hostname) {
          host.push({ fileName: assignment.fileName, fragment: fragment.fragment })
        }
      }
    }

    res.json({
      payload: {
        host,
        requests: session.data.studentTemplates[hostname] ?? null,
      },
    })
  })
}
