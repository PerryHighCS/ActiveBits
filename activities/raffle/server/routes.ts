import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

interface RaffleSessionData extends Record<string, unknown> {
  tickets: number[]
}

interface RaffleSession extends SessionRecord {
  type?: string
  data: RaffleSessionData
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: Record<string, unknown>): void
}

interface RaffleRequest {
  params: {
    raffleId: string
  }
}

interface RaffleRouteApp {
  post(path: string, handler: (req: unknown, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RaffleRequest, res: JsonResponse) => void | Promise<void>): void
}

registerSessionNormalizer('raffle', (session) => {
  const data =
    session.data != null && typeof session.data === 'object' && !Array.isArray(session.data)
      ? (session.data as Record<string, unknown>)
      : {}
  session.data = data
  data.tickets = Array.isArray(data.tickets) ? data.tickets : []
})

const raffleSubscribers = new Map<string, Set<ActiveBitsWebSocket>>()

function addSubscriber(raffleId: string, socket: ActiveBitsWebSocket): void {
  const subscribers = raffleSubscribers.get(raffleId)
  if (subscribers) {
    subscribers.add(socket)
    return
  }

  raffleSubscribers.set(raffleId, new Set([socket]))
}

function removeSubscriber(raffleId: string, socket: ActiveBitsWebSocket): void {
  const subscribers = raffleSubscribers.get(raffleId)
  if (!subscribers) return

  subscribers.delete(socket)
  if (subscribers.size === 0) {
    raffleSubscribers.delete(raffleId)
  }
}

function broadcastTicketsUpdate(raffleId: string, tickets: number[]): void {
  const subscribers = raffleSubscribers.get(raffleId)
  if (!subscribers || subscribers.size === 0) return

  const payload = JSON.stringify({ type: 'tickets-update', tickets })
  const staleSockets: ActiveBitsWebSocket[] = []

  for (const socket of subscribers) {
    if (socket.readyState === 1) {
      socket.send(payload)
    } else {
      staleSockets.push(socket)
    }
  }

  for (const socket of staleSockets) {
    subscribers.delete(socket)
  }

  if (subscribers.size === 0) {
    raffleSubscribers.delete(raffleId)
  }
}

function sendRaffleError(socket: ActiveBitsWebSocket, error: string): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'raffle-error', error }))
  }
}

async function getRaffleSession(sessions: SessionStore, raffleId: string): Promise<RaffleSession | null> {
  const session = await sessions.get(raffleId)
  if (!session || session.type !== 'raffle') {
    return null
  }

  if (!Array.isArray(session.data.tickets)) {
    session.data.tickets = []
  }

  return session as RaffleSession
}

export default function setupRaffleRoutes(app: RaffleRouteApp, sessions: SessionStore, ws: WsRouter): void {
  app.post('/api/raffle/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })

    session.type = 'raffle'
    session.data.tickets = []

    await sessions.set(session.id, session)

    res.json({ id: session.id })
  })

  app.get('/api/raffle/generateTicket/:raffleId', async (req, res) => {
    const raffle = await getRaffleSession(sessions, req.params.raffleId)
    if (!raffle) {
      console.log(`Request to generate ticket for invalid raffle ${req.params.raffleId}`)
      res.status(404).json({ error: 'invalid raffle' })
      return
    }

    const ticket = Math.floor(Math.random() * 10000)
    raffle.data.tickets.push(ticket)
    await sessions.set(raffle.id, raffle)

    res.json({ ticket })

    broadcastTicketsUpdate(raffle.id, raffle.data.tickets)
  })

  app.get('/api/raffle/listTickets/:raffleId', async (req, res) => {
    const raffle = await getRaffleSession(sessions, req.params.raffleId)
    if (!raffle) {
      console.log(`Request to list tickets for invalid raffle ${req.params.raffleId}`)
      res.status(404).json({ error: 'invalid raffle' })
      return
    }

    res.json({ tickets: raffle.data.tickets })
  })

  ws.register('/ws/raffle', (socket, query) => {
    const raffleId = query.get('raffleId')
    if (!raffleId) {
      socket.close(1008, 'Missing raffleId')
      return
    }

    socket.sessionId = raffleId
    addSubscriber(raffleId, socket)

    ;(async () => {
      const raffle = await getRaffleSession(sessions, raffleId)
      if (!raffle) {
        sendRaffleError(socket, 'Raffle not found')
        socket.close(1008, 'Invalid raffle')
        return
      }

      socket.send(
        JSON.stringify({
          type: 'tickets-update',
          tickets: raffle.data.tickets,
        }),
      )
    })().catch((error: unknown) => {
      console.error('Failed to send initial raffle tickets', error)
      sendRaffleError(socket, 'Unable to load raffle tickets')
    })

    socket.on('close', () => removeSubscriber(raffleId, socket))
    socket.on('error', () => removeSubscriber(raffleId, socket))
  })
}
