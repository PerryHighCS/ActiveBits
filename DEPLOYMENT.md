# ActiveBits Deployment Guide

This guide covers deploying ActiveBits to Render.com with Valkey (Redis-compatible) session storage for persistence across deployments and horizontal scaling.

## Architecture Overview

### Session Storage Modes

ActiveBits supports two session storage modes:

1. **In-Memory Mode** (Development/Testing)
   - No external dependencies
   - Sessions lost on restart
   - Fast performance
   - Automatic when `VALKEY_URL` is not set

2. **Valkey Mode** (Production)
   - Persistent session storage
   - Survives hot redeployments
   - Supports horizontal scaling
   - Redis pub/sub for cross-instance coordination
   - Automatic when `VALKEY_URL` is set

### Components

- **Session Store**: Temporary session data (1-hour TTL)
- **Persistent Metadata**: Waiting room state (10-minute TTL)
- **WebSocket Keepalive Cache**: In-memory cache (30s TTL) for reducing Valkey traffic
- **Pub/Sub Channels**: Cross-instance broadcasting for session events

## Render.com Deployment

### Prerequisites

- Render.com account
- GitHub repository with ActiveBits code
- Node.js 22+ environment

### Step 1: Create Valkey Instance

1. Go to Render Dashboard
2. Click **New** → **Redis**
3. Configure:
   - **Name**: `activebits-valkey`
   - **Plan**: Choose based on expected load (Starter plan works for small deployments)
   - **Region**: Same as your web service for low latency
4. Click **Create Redis**
5. Wait for provisioning to complete
6. Copy the **Internal Redis URL** (format: `redis://red-xxxxx:6379`)

### Step 2: Create Web Service

1. Go to Render Dashboard
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `activebits`
   - **Region**: Same as Valkey instance
   - **Branch**: `main` (or your deployment branch)
   - **Runtime**: Node
   - **Build Command**: `npm install --include=dev --workspaces --include-workspace-root && npm run build --workspace client && npm run build --workspace server`
   - **Start Command**: `cd server && npm start`
   - **Plan**: Choose based on expected traffic (Starter plan for testing, Standard+ for production)

   **TypeScript server runtime policy (current)**:
   - `npm run build --workspace server` runs `tsc -p server/tsconfig.build.json` and emits `server/dist/server.js` from `server/server.ts` plus other `server/**/*.ts` modules.
   - `npm start` runs compiled output (`dist/server.js`) when present, and falls back to TS runtime (`node --import tsx server.ts`) when dist output is absent.
   - Production expectation remains compiled runtime (`node dist/server.js`).

5. **Environment Variables**:
   ```
   NODE_ENV=production
   VALKEY_URL=<paste-internal-redis-url-from-step-1>
   PERSISTENT_SESSION_SECRET=<generate-random-32+-char-string>
   SESSION_TTL_MS=3600000
   HOST=0.0.0.0 
   ```

   **Important**: Generate a strong random secret for `PERSISTENT_SESSION_SECRET`:
   ```bash
   # Generate a secure secret (run locally)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. **Advanced Settings**:
   - **Health Check Path**: `/health-check`
   - **Auto-Deploy**: Yes (for continuous deployment)

7. Click **Create Web Service**

### Step 3: Enable Session Affinity (Sticky Sessions)

**Critical for WebSocket connections when scaling horizontally!**

1. In your web service settings, go to **Settings** → **Scaling**
2. If you plan to scale beyond 1 instance:
   - Contact Render support to enable session affinity
   - Or use Render's proxy with sticky sessions
   - Or accept that WebSocket clients may need to reconnect on rebalancing

**Note**: For single-instance deployments, sticky sessions are not required.

### Step 4: Verify Deployment

1. Wait for the build to complete
2. Check logs for:
   ```
   Using Valkey session store with caching
   Using Valkey for persistent session metadata
   ActiveBits server running on http://0.0.0.0:3000
   ```
3. Visit your Render URL (e.g., `https://activebits.onrender.com`)
4. Test health check: `https://activebits.onrender.com/health-check`
5. Create a test activity session and verify it persists after redeployment

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VALKEY_URL` | No | (none) | Valkey/Redis connection URL. If not set, uses in-memory storage. |
| `NODE_ENV` | No | `development` | Set to `production` for production deployment. |
| `PERSISTENT_SESSION_SECRET` | **Yes** | (dev fallback only) | HMAC secret for persistent session links. Production startup fails if missing or weak. |
| `SESSION_TTL_MS` | No | `3600000` | Session TTL in milliseconds (default: 1 hour). |
| `PORT` | No | `3000` | Server port (Render sets this automatically). |

## Source Map Policy (Open-Source Repo)

ActiveBits intentionally ships source maps in production for debugging and teaching transparency.

1. **Client source maps**:
   - Enable Vite production source maps (`build.sourcemap: true`).
   - Publish generated `.map` files with client assets.

2. **Server source maps (post-TypeScript migration / TS server emit available)**:
   - Keep `sourceMap: true` in `server/tsconfig.build.json`.
   - Deploy emitted `.map` files with `server/dist`.

3. **Operational verification**:
   - Confirm `.map` files are present in deployment artifacts.
   - Verify stack traces map to original TypeScript source during incident debugging.

## Scaling Considerations

### Single Instance (Default)

- No special configuration needed
- Valkey provides persistence across redeployments
- All WebSocket connections handled by one instance

### Multiple Instances (Horizontal Scaling)

When scaling to multiple instances:

1. **Session Affinity**: Enable sticky sessions to route WebSocket connections to the same instance
2. **Pub/Sub**: Already configured via Valkey for cross-instance broadcasts
3. **Cache Coordination**: Each instance maintains its own keepalive cache; pub/sub handles consistency
4. **Persistent Sessions**: Shared via Valkey; waiters are instance-local

**To scale horizontally**:
1. Go to **Settings** → **Scaling**
2. Increase instance count
3. Ensure session affinity is enabled
4. Monitor Valkey connections (each instance creates 2 connections: regular + pub/sub)

## Hot Redeployment Behavior

When a new deployment is triggered:

1. **Graceful Shutdown** (30s timeout):
   - Server stops accepting new connections
   - Flushes in-memory cache to Valkey
   - Closes Valkey connections gracefully
   - WebSocket clients receive disconnect

2. **Client Reconnection**:
   - Clients automatically reconnect to new instance
   - Session data restored from Valkey
   - Student progress preserved

3. **Zero Data Loss**:
   - Periodic cache flush (every 30s)
   - Final flush on SIGTERM
   - TTL extends on reconnection

## Monitoring

### Key Metrics to Monitor

1. **Valkey Connection Health**:
   - Check `/health-check` endpoint
   - Monitor Valkey dashboard on Render
   - Watch for connection errors in logs

2. **Session Count**:
   - Valkey keys with prefix `session:*`
   - Valkey keys with prefix `persistent:*`

3. **Runtime Status Endpoints**:
   - `GET /health-check` — Basic liveness + process memory
   - `GET /api/status` — Detailed JSON (storage mode, TTLs, process metrics, WebSocket clients, sessions summary, Valkey info)
   - `GET /status` — HTML dashboard that auto-updates, useful for quick checks during deployment or incidents

4. **Cache Hit Rate**:
   - Not exposed by default; add custom metrics if needed
   - Effective cache reduces Valkey read operations

5. **WebSocket Connections**:
   - Monitor active WebSocket count
   - Check reconnection patterns after deployment

### Troubleshooting

**Symptoms**: Sessions lost after deployment
- **Cause**: `VALKEY_URL` not set
- **Fix**: Set environment variable and redeploy

**Symptoms**: "Teacher code invalid" after deployment
- **Cause**: `PERSISTENT_SESSION_SECRET` changed
- **Fix**: Use same secret across deployments (never rotate during active sessions)

**Symptoms**: WebSocket disconnects frequently
- **Cause**: Scaling without session affinity
- **Fix**: Enable sticky sessions or use single instance

**Symptoms**: Status dashboard shows "not using Valkey" unexpectedly
- **Cause**: `VALKEY_URL` missing or misconfigured; container cannot reach Valkey
- **Fix**: Verify `VALKEY_URL` (use internal URL on Render), check Valkey instance health; confirm `/api/status` shows `mode: valkey` and Valkey `ping: PONG`

**Symptoms**: High Valkey latency
- **Cause**: Valkey instance in different region or overloaded
- **Fix**: Move Valkey to same region, upgrade plan, or reduce TTL/cache flush frequency

## Cost Optimization

### Development/Testing
- **Valkey**: Starter plan (~$7/month)
- **Web Service**: Starter plan (~$7/month)
- **Total**: ~$14/month

### Small Production (<100 concurrent sessions)
- **Valkey**: Starter plan (~$7/month)
- **Web Service**: Standard plan (~$25/month)
- **Total**: ~$32/month

### Large Production (100+ concurrent sessions)
- **Valkey**: Standard+ plan (~$35/month)
- **Web Service**: Pro plan + scaling (~$85/month + per instance)
- **Total**: ~$120+/month

**Optimization Tips**:
1. Increase cache TTL to reduce Valkey reads (trade: longer stale data window)
2. Reduce session TTL if users don't need long sessions
3. Use single instance if horizontal scaling not needed
4. Monitor Valkey memory usage; evict old sessions if needed

## Security Best Practices

1. **HTTPS Only**: Render provides automatic HTTPS
2. **Secure Cookies**: Enabled in production via `NODE_ENV=production`
3. **Strong Secrets**: Use 32+ character random strings for `PERSISTENT_SESSION_SECRET`
4. **Rate Limiting**: Built-in for teacher code attempts (5 attempts/minute per IP+hash)
5. **Valkey Access**: Use internal URLs only (not publicly accessible)

## Backup and Recovery

### Session Data
- **Ephemeral**: Sessions expire after TTL (default 1 hour)
- **No backup needed**: Designed for temporary interactive sessions
- **Recovery**: Students can rejoin with same name/ID

### Persistent Links
- **Stored in cookies**: Teacher codes stored client-side
- **Exportable**: `/api/persistent-session/list` returns all user's sessions
- **No server backup needed**: Links regenerated from teacher code + activity name

## Migration from In-Memory to Valkey

To migrate an existing deployment:

1. Create Valkey instance (Step 1 above)
2. Add `VALKEY_URL` environment variable
3. Redeploy
4. **Warning**: All active sessions will be lost during this transition
5. Future sessions will persist across redeployments

## Local Development with Valkey

For local testing with Valkey:

1. Install Valkey/Redis locally:
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Ubuntu
   sudo apt install redis-server
   sudo systemctl start redis
   ```

2. Set environment variable:
   ```bash
   export VALKEY_URL=redis://localhost:6379
   ```

3. Run server:
   ```bash
   cd server
   npm run dev
   ```

4. Verify logs show "Using Valkey session store"

## Support and Resources

- **Render Documentation**: https://render.com/docs
- **Valkey GitHub**: https://github.com/valkey-io/valkey
- **ioredis Documentation**: https://github.com/redis/ioredis
- **ActiveBits Repository**: [Your GitHub URL]

## Changelog

- **2024-12**: Initial Valkey integration with pub/sub support
- **2024-12**: Added keepalive caching layer for performance
- **2024-12**: Implemented graceful shutdown for hot redeployments (WebSockets now drain in ~1s before the process exits)
