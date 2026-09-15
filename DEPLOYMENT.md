# ActiveBits Deployment Guide

This guide is the production runbook for ActiveBits on Render. It covers the
configuration, verification, monitoring, and recovery actions an operator needs.
For system design and runtime behavior, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Deployment requirements

- A Render web service running Node.js 24.x.
- A Render Key Value instance in the same region as the web service. New instances
  run Valkey and are Redis-compatible.
- A strong, stable `PERSISTENT_SESSION_SECRET` stored as a Render secret.
- HTTPS at the public edge. ActiveBits uses secure, httpOnly cookies for teacher,
  manager, participant, and embedded-session recovery.

## Render setup

### 1. Create the Key Value instance

1. In the Render Dashboard, select **New** > **Key Value**.
2. Choose the same region as the web service.
3. Select a plan with enough memory and connections for the expected session load.
4. Create the instance and copy its **internal** connection URL.

Use the internal URL only. It requires the Key Value instance and web service to
be in the same Render workspace and region, and avoids exposing the datastore
publicly.

### 2. Create the web service

Create a Node web service from the deployment branch with these commands:

| Setting | Value |
| --- | --- |
| Build command | `npm install --include=dev --workspaces --include-workspace-root && npm run build --workspace client && npm run build --workspace server` |
| Start command | `npm start --prefix server` |
| Health check path | `/health-check` |

The build emits the TypeScript server under `server/dist` and the client under
`client/dist`. The start command runs the compiled server when that output is
present.

Configure these environment variables:

| Variable | Required | Value or default |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `VALKEY_URL` | Yes for production persistence and multi-instance operation | Internal Render Key Value URL |
| `PERSISTENT_SESSION_SECRET` | Yes | Unique random value of at least 32 characters |
| `SESSION_TTL_MS` | No | `3600000` (one hour) |
| `HOST` | No | `0.0.0.0` |
| `PORT` | No | Render supplies this automatically |
| `LEARN_SYNCDECK_HMAC_SECRET` | Only for the Learn SyncDeck integration | Dedicated shared secret; never reuse an LTI secret |
| `LEARN_SYNCDECK_HMAC_KEY_ID` | No | `learn-default` |

Generate a suitable persistent-session secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Preserve proxy and browser-security behavior

- Terminate TLS before traffic reaches the app. Production cookies require HTTPS.
- Preserve WebSocket upgrades and same-origin cookie forwarding through any proxy.
- Do not rewrite the cookie paths or `SameSite`/`Secure` attributes set by the app.
- Redact query strings in proxy and access logs for Learn substitute-instructor
  capability URLs, which are bearer links.
- Keep SyncDeck embedded activity iframes permitted to use `autoplay` and
  `fullscreen`; synchronized media depends on those permissions.

### 4. Deploy and verify

After a successful deploy:

1. Check that startup logs identify the selected session-store mode.
2. Request `/health-check`; it must return a 2xx response.
3. Open `/manage`, create a test session, and confirm that it survives a
   redeployment when `VALKEY_URL` is configured.
4. Request `/api/status` and confirm `storage.mode` is `valkey` in production.
5. For SyncDeck or Learn deployments, exercise an embedded launch in its intended
   HTTPS/LMS context.

## Scaling and redeployment

### Single instance

A single instance is the default. Configure `VALKEY_URL` if sessions must survive
redeployments; without it, all sessions are in memory and are lost on restart.

### Multiple instances

Before increasing the instance count:

1. Configure a shared Valkey-backed store through `VALKEY_URL`.
2. Enable sticky/session affinity for WebSocket traffic where the hosting setup
   supports it, or expect clients to reconnect after rebalancing.
3. Ensure every instance uses the same `PERSISTENT_SESSION_SECRET` and relevant
   Learn integration secrets.
4. Monitor Key Value connection use and memory as instances are added.

The system uses Valkey pub/sub and atomic session updates for shared session
coordination. See [Atomic Session Mutation](ARCHITECTURE.md#atomic-session-mutation)
for the implementation and compatibility model.

On a normal redeploy, clients reconnect and Valkey-backed sessions remain
available. Moving an existing deployment from in-memory storage to Valkey loses
currently active in-memory sessions; schedule that change between classes.

## Deploy artifacts

- Deploy all generated files under `client/dist`, including every hashed asset in
  `client/dist/assets`. MobCode lazy-loads client chunks after initial load.
- Include the `zxing_reader-*.wasm` asset emitted for QR scanning.
- Keep server source maps from `server/dist` and client `.map` files: this
  open-source project intentionally ships production source maps for debugging.
- Do not deploy SyncDeck sample decks from `activities/syncdeck/dev-presentations/`.

## Monitoring and incident response

| Surface | Use |
| --- | --- |
| `/health-check` | Liveness probe for Render |
| `/api/status` | JSON storage mode, TTL, process, WebSocket, session, and Valkey status |
| `/status` | Human-readable status dashboard for deployment checks and incidents |
| Render logs | Startup store selection, connection errors, and structured server events |
| Render Key Value dashboard | Connection and memory capacity |

Monitor active WebSocket connections, session count, Valkey connection failures, and
Key Value memory. Do not log capability tokens, secrets, or full bearer URLs.

### Troubleshooting

| Symptom | Check and action |
| --- | --- |
| Sessions disappear after a deploy | Confirm `VALKEY_URL` is set to the internal Key Value URL, then redeploy. |
| Persistent teacher authentication fails after a deploy | Confirm `PERSISTENT_SESSION_SECRET` did not change. Do not rotate it during active sessions. |
| Frequent WebSocket disconnects after scale-out | Check WebSocket proxying and affinity/rebalancing behavior; use one instance while isolating the issue. |
| `/api/status` reports in-memory mode | Verify `VALKEY_URL`, region/workspace alignment, and Key Value health. |
| High Valkey latency | Place services in the same region, check capacity, then consider a larger Key Value plan. |
| SyncDeck iframe is blocked | Serve the presentation over HTTPS; ordinary non-loopback HTTP content is blocked from the HTTPS app. |
| Embedded YouTube reports error 153 | Preserve the SyncDeck referrer policy and allow YouTube resources in any content blocker. |

## Backup and recovery

Live sessions are ephemeral and expire according to `SESSION_TTL_MS`; they are not a
backup system. Persistent teacher links can be exported through
`/api/persistent-session/list`. For a datastore outage, restore Key Value service,
verify `/api/status`, and have users reconnect.

## Further reference

- [Architecture and session model](ARCHITECTURE.md)
- [Deployment notes and operational history](.agent/knowledge/deployment-notes.md)
- [Security notes](.agent/knowledge/security-notes.md)
- [Render Key Value documentation](https://render.com/docs/key-value)
- [Render health checks documentation](https://render.com/docs/health-checks)
