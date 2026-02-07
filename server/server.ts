import http from 'node:http'
import type { Socket } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createSessionStore, setupSessionRoutes } from './core/sessions.js'
import { createWsRouter } from './core/wsRouter.js'
import { initializePersistentStorage } from './core/persistentSessions.js'
import { setupPersistentSessionWs } from './core/persistentSessionWs.js'
import { registerActivityRoutes, initializeActivityRegistry } from './activities/activityRegistry.js'
import { registerStatusRoute } from './routes/statusRoute.js'
import { registerPersistentSessionRoutes } from './routes/persistentSessionRoutes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())
app.use(cookieParser())

const server = http.createServer(app)

// Initialize session storage (Valkey if VALKEY_URL is set, otherwise in-memory).
const valkeyUrl = process.env.VALKEY_URL || null
const sessionTtl = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000
const sessions = createSessionStore(valkeyUrl, sessionTtl)
app.locals.sessions = sessions as unknown as never

if (sessions.initializePubSub) {
  sessions.initializePubSub()
}

if (valkeyUrl && sessions.valkeyStore) {
  initializePersistentStorage(sessions.valkeyStore.client)
} else {
  initializePersistentStorage(null)
}

const ws = createWsRouter(server, sessions)
setupSessionRoutes(app, sessions, ws.wss)

setupPersistentSessionWs(ws, sessions)
registerPersistentSessionRoutes({ app, sessions })

await initializeActivityRegistry()
await registerActivityRoutes(app, sessions, ws)

registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl })
app.get('/health-check', (_req, res) => {
  res.json({ status: 'ok', memory: process.memoryUsage() })
})

const env = process.env.NODE_ENV || 'development'
if (!env.startsWith('dev')) {
  app.use(express.static(path.join(__dirname, '../client/dist')))
  app.get('/*fallback', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  })
} else {
  process.on('warning', (warning) => {
    console.warn(warning.stack)
  })

  const { createProxyMiddleware } = await import('http-proxy-middleware')
  const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 30_000 })

  const viteProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:5173',
    changeOrigin: true,
    ws: true,
    xfwd: true,
    agent: keepAliveAgent,
    proxyTimeout: 30_000,
    timeout: 30_000,
    headers: {
      connection: 'keep-alive',
    },
    pathFilter: (pathname) => {
      if (pathname.startsWith('/api')) return false
      if (pathname.startsWith('/ws')) return false
      return true
    },
  })

  app.use(viteProxy)

  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/vite-hmr')) {
      viteProxy.upgrade?.(req, socket as Socket, head)
      return
    }
  })
}

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '127.0.0.1'
server.listen(PORT, HOST, () => {
  console.log(`ActiveBits server running on \x1b[1m\x1b[32mhttp://localhost:${PORT}\x1b[0m`)
})

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received. Starting graceful shutdown...`)

  const closeWebSockets = () =>
    new Promise<void>((resolve) => {
      if (!ws?.wss) {
        resolve()
        return
      }

      const clients = Array.from(ws.wss.clients)
      if (clients.length === 0) {
        ws.wss.close(() => resolve())
        return
      }

      let remaining = clients.length
      let finalized = false
      const finalize = (): void => {
        if (finalized) return
        finalized = true
        ws.wss.close(() => resolve())
      }

      const onClientClosed = (): void => {
        remaining -= 1
        if (remaining <= 0) finalize()
      }

      clients.forEach((client) => {
        client.once('close', onClientClosed)
        try {
          client.close(1001, 'Server shutting down')
        } catch {
          onClientClosed()
        }
      })

      setTimeout(finalize, 1000)
    })

  const webSocketClosePromise = closeWebSockets()

  server.close(async () => {
    console.log('HTTP server closed')
    await webSocketClosePromise

    if (sessions.flushCache) {
      console.log('Flushing session cache...')
      await sessions.flushCache()
    }

    if (sessions.close) {
      console.log('Closing Valkey connections...')
      await sessions.close()
    }

    console.log('Graceful shutdown complete')
    process.exit(0)
  })

  setTimeout(() => {
    console.error('Forced shutdown after timeout')
    process.exit(1)
  }, 30_000)
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

if (sessions.flushCache) {
  const flushInterval = setInterval(async () => {
    try {
      await sessions.flushCache?.()
    } catch (err) {
      console.error('Error flushing cache:', err)
    }
  }, 30_000)
  flushInterval.unref()
}
