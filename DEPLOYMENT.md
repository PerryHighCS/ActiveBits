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
- **JSON request body budget**: Most routes keep Express's default JSON body limit. Only the `/api/mobcode` route prefix uses an `8mb` parser budget, and MobCode file-state payloads are capped lower at `4 MiB` after parsing.

## Render.com Deployment

### Prerequisites

- Render.com account
- GitHub repository with ActiveBits code
- Node.js 24.x environment

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
6. Verify the production activity registry surfaces all intended dashboard cards, including Resonance on `/manage`

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

## Bundled Client Runtime Assets

- The shared QR scanner uses `react-zxing` with the `zxing-wasm` reader binary imported through Vite. Production client builds emit `zxing_reader-*.wasm` under `client/dist/assets/`; deploy that file with the rest of the built client assets so QR scanning does not fall back to a third-party CDN.

## Dev-Only Presentation Assets

SyncDeck sample decks that exist only for local development live under `activities/syncdeck/dev-presentations/`.

- They may use permissive local-development settings that are not suitable for production embedding.
- Vite serves them during local development from the same `/presentations/...` URLs used by the app.
- Production builds must not emit these dev-only presentation files.

## SyncDeck Embedded Media

- SyncDeck's internal embedded-activity iframes delegate `autoplay` and `fullscreen` so synchronized, muted media players (including Video Sync's nested YouTube player) can start from an instructor playback command. Keep this iframe permission policy intact when configuring a reverse proxy or content-security policy.
- SyncDeck processes instructor websocket updates in arrival order before persisting session state. Deployments with Valkey should retain this single-connection ordering behavior; no additional proxy affinity setting is required beyond the websocket guidance above.

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
5. **Teacher/manager credential recovery**: Keep the `persistent_sessions` httpOnly cookie path and same-site behavior intact, since activities such as SyncDeck and Video Sync recover manager credentials from a teacher-validated persistent-session cookie after redirects into `/manage/...`. Dashboard-created Video Sync sessions carry the generated instructor passcode through router state plus the shared same-tab bootstrap cache; do not persist that passcode in browser storage.
   The separate `activebits_student_display_name` cookie is JavaScript-readable by design and contains only a student's display name; preserve its site-wide path and `SameSite=Lax` behavior, but do not reuse it for identities, authentication, or sensitive fields.
6. **SyncDeck teacher redirects**: Teacher entry into started SyncDeck permalinks must strip the permalink query before redirecting to `/manage/syncdeck/:sessionId`. The manager recovers the authoritative deck URL and canonical permalink state from the session/cookie path instead of trusting stale or unsigned permalink query params on the manage route.
   Temporary SyncDeck manager creation also adds a session-scoped token to a bounded browser-session httpOnly recovery cookie. Preserve same-origin cookie forwarding, the `/api/syncdeck` cookie path, `SameSite=Lax`, and the production `Secure` flag so a reload can recover instructor control without putting a passcode in browser storage. The server session's sliding TTL, not a fixed cookie expiry, remains authoritative.
7. **Video Sync unsynced-student telemetry**: In Valkey mode, `video-sync` stores per-session unsynced-student timestamps in a Valkey-backed key (with short TTL pruning) so `telemetry.sync.unsyncedStudents` stays coherent when `/api/video-sync/:sessionId/event` requests land on different instances. In in-memory mode this telemetry remains single-instance only, which is acceptable for local/dev deployments.
8. **Embedded child bootstrap payloads**: SyncDeck embedded launches now persist child-session bootstrap data under `session.data.embeddedLaunch.selectedOptions`. That session record must survive reloads and hot redeploys because embedded managers such as Video Sync rehydrate launch intent from the sanitized `GET /api/session/:childSessionId/embedded-launch` endpoint. In production, validate that this route remains available after deploys and returns only `{ embeddedLaunch: { selectedOptions } }`, not the raw session record.
9. **SyncDeck embedded-session keepalive coupling**: launched embedded child sessions are expected to stay alive while their parent SyncDeck session is still active, and child-session reads now refresh the parent too. In production, treat unexpected pruning of either side as a keepalive regression rather than as normal temporary-session expiry.
10. **Canonical persistent-link recovery**: Persistent manager recovery routes that return bootstrap data (for example Video Sync `persistentSourceUrl`) should source that data from canonical remembered permalink `selectedOptions` rather than from raw query params on redirected manage routes.
11. **Activity live-run compatibility fields**: When activity session schemas gain new runtime fields, preserve them across redeploys and normalizer passes. Resonance now relies on `activeQuestionIds` and `activeQuestionDeadlineAt` for multi-question live runs, while older consumers may still read the compatibility field `activeQuestionId`.
12. **SyncDeck static-presentation utilities**: `/util/syncdeck/launch-presentation` and `/util/syncdeck/permalink` are same-origin browser utility flows, not cross-origin API integrations. They depend on the client being able to iframe-load and preflight the requested `presentationUrl` from the ActiveBits origin before creating a session or permalink. If deployment policy blocks that iframe load or the URL fails Reveal sync preflight, the utilities must stop before creating server state. The launch utility creates a standalone student session by default and redirects to `/:sessionId`; `mode=instructor` creates a hosted instructor session, hands the generated instructor passcode to the manager through same-tab router state only, clears that router state after consumption, and redirects to `/manage/syncdeck/:sessionId?presentationUrl=...`. Do not use `sessionStorage`, `localStorage`, IndexedDB, or other browser storage for SyncDeck instructor passcodes; if reload-stable recovery is needed later, use httpOnly cookies or short-lived server-issued recovery tokens. The permalink utility renders a teacher-code builder page and calls `POST /api/syncdeck/generate-url` only after verification. Deployments should preserve both `presentationUrl` and `presentation-url` query spellings for externally hosted deck links.
13. **Teacher Join recovery**: The home-page `Teacher Join` flow authenticates a live `sessionId` by resolving it back to shared persistent-session metadata. In multi-instance deployments, that active-session-to-persistent lookup must remain available anywhere the live session can be resumed.
14. **SyncDeck embedded activity start serialization**: SyncDeck serializes `/api/syncdeck/:sessionId/embedded-activity/start` per `sessionId + instanceKey` inside each app process so concurrent instructors on the same instance cannot create duplicate child sessions for the same slide anchor. This is a per-process guard, so sticky routing still helps minimize any remaining cross-instance race window.
15. **SyncDeck embedded activity identity**: SyncDeck derives embedded activity instance keys from the instructor-visible Reveal position and also persists a separate `location` object on the parent embedded activity record. Activation should rely on this stored/broadcast location instead of presentation-authored IDs, so parent and child session records must preserve `location` across redeploys.
16. **SyncDeck embedded activity websocket bootstrap**: New SyncDeck instructor/student websocket connections replay currently stored embedded-activity starts from `session.data.embeddedActivities`. Student replays also mint fresh child-session entry tokens, so the parent and child session records must be read/write consistent across the instance that accepts the websocket.
17. **Standalone activity launcher route**: `/launch/:activityId` is a client-owned launcher page. It must remain safe to load because the GET route does not create sessions; session creation still happens through `POST /api/:activityId/create` after the launcher button or explicit `?start=1` client auto-start. Deployments should preserve fallback routing to the SPA for `/launch/...` paths.
18. **Video Sync natural completion handoff**: When the instructor preview reaches YouTube's natural `ENDED` state, the manager client converts that player event into the same authoritative pause command used for manual pauses. Preserve that browser-to-command path so the server does not continue projecting a finished video as still playing and heartbeat updates do not restart the preview loop.
19. **SyncDeck embedded manager bootstrap timing**: SyncDeck embedded-start responses carry a short-lived `managerEntryToken` for the child manager. The parent must wait for this authenticated response before mounting the instructor iframe. Credentialed children exchange the token at the same-origin SyncDeck endpoint for their child passcode, then replace the URL to remove the attempted query token whether that exchange succeeds or fails; credentialless children such as Raffle use the token only as a parent launch-readiness signal and do not redeem it. In-memory and Valkey session stores must preserve atomic token consumption for credentialed children so concurrent requests cannot redeem a token twice. This avoids the websocket-start race and does not persist credentials in browser storage. Ad-hoc sessions depend on this path because they do not have persistent teacher-cookie recovery.
    The parent manager also reconciles that authenticated start response locally; do not rely exclusively on the instructor websocket lifecycle echo, because an activity request can precede websocket authentication on first load. Validate that the response `instanceKey` matches the requested embedded instance before applying credentials, lifecycle state, retry completion, or success UI.
    A child whose exchange fails requests a fresh bootstrap from its same-origin parent by child-session id only; the parent must keep this message path and authenticated refresh behavior intact so consumed or stale tokens do not leave an embedded manager unauthenticated. Refreshes are bounded per child and must preserve parent backfill retry history so hard failures still surface recovery UI.
20. **SyncDeck embedded manager recovery**: The client treats 5xx embedded-start failures as transient and retries them with a bounded backoff, but presents the explicit recovery action immediately for non-retryable failures. Warm-iframe eviction clears all bootstrap retry/failure state for the evicted child so a return to that slide can request a new short-lived token.
21. **MobCode Python runner popup**: The MobCode Python runner opens a same-origin popup and loads Brython from the npm-installed `brython` package through a rate-limited, allowlisted `/vendor/brython/...` route for `brython.min.js`, `brython.js`, and `brython_stdlib.js` before executing the selected Python entry file in the browser. Production deployments must include installed workspace dependencies so those vendor assets are present beside the server process. Interactive terminal `input()` is handled by compiling the entry file into an async worker wrapper and passing prompt responses through worker messages, so it does not require cross-origin-isolated shared memory. The popup includes a Stop control that terminates the active worker, caps terminal output to avoid runaway print loops exhausting the page, blocks direct imports of browser/JavaScript/system escape-hatch modules in the terminal runner profile, preflights unsupported entry imports before Brython attempts browser module loading, rewrites common `time.sleep(...)` calls to an async browser sleep bridge, and exposes only read-only MobCode workspace files through helper imports and `open(...)`. Python failures report the deepest applicable line in the selected entry file; Brython wrapper frames are skipped so assertion and other runtime errors point to user code.

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

**Symptoms**: SyncDeck student view reports blocked insecure content or `postMessage` target-origin errors against an HTTP presentation URL
- **Cause**: ActiveBits is running on HTTPS, but the configured presentation URL is an HTTP origin that the browser does not treat as loopback-secure. Browsers block those mixed-content iframes, so the deck never loads in the student iframe.
- **Fix**: For normal hosted decks, serve the presentation over HTTPS as well. Loopback testing URLs such as `http://localhost` and `http://127.0.0.1` may work in some browsers, but non-loopback HTTP origins will not.

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
5. **Reverse Proxy**: In production, the server trusts one proxy hop so Render-forwarded client IPs feed IP-based rate limits.
6. **Valkey Access**: Use internal URLs only (not publicly accessible)

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
