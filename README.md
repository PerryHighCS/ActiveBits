# ActiveBits

**ActiveBits** is a modular, interactive activity server designed for classroom use.  
It currently supports:

- 🎟️ **Raffle Tickets** – Students scan a QR code to receive a unique ticket.
  * Use raffles to explore search algorithms: run a raffle, assign tickets, choose a winner, and search for that ticket.
  * Use pair and group raffles to highlight the difference between reasonable and unreasonable algorithms (e.g., finding sets that sum to a target).
  * Teacher dashboard receives live ticket updates over WebSockets—no refresh required.

- 🌐 **Network Scavenger Hunts** – Simulate IP-based discovery and HTTP interactions.

- ☕ **Java String Practice** – Interactive practice for Java String methods including `substring()`, `indexOf()`, `equals()`, `length()`, and `compareTo()`.
  * Real-time teacher control of which methods students practice
  * Live student progress tracking with sortable statistics
  * Solo mode for self-paced learning
  * Downloadable CSV reports for classroom assessment

Future modules will include additional hands-on learning tools for computer science and engineering classrooms.

## 📚 Documentation

- **[Adding Activities](ADDING_ACTIVITIES.md)** - Start here! Complete tutorial with working code examples
- **[Architecture Guide](ARCHITECTURE.md)** - Deep dive into codebase structure, patterns, and design decisions
- **[Deployment Guide](DEPLOYMENT.md)** - Production deployment to Render with Valkey session storage

---

## 🌐 Access

- **Student site:** [`https://bits.mycode.run`](https://bits.mycode.run)  
- **Instructor dashboard:** [`https://bits.mycode.run/manage`](https://bits.mycode.run/manage)

### Persistent Sessions

Teachers can create permanent activity links that persist across browser sessions:
- Create permanent links from the management dashboard
- Auto-authentication with unique teacher codes stored in browser cookies
- Manage all permanent sessions from one place
- Download CSV backup of permanent links

---

## 🛠️ Development

### Dev Container Setup (Recommended)

The project includes a dev container with Valkey pre-configured:

```bash
# Open in VS Code or GitHub Codespaces
# The container will automatically:
# - Install dependencies
# - Start Valkey service
# - Configure VALKEY_URL environment variable

# Test Valkey connection
cd server
npm run test:valkey

# Start the dev server (uses Valkey automatically)
npm run dev
```

See **[docs/VALKEY_DEVELOPMENT.md](docs/VALKEY_DEVELOPMENT.md)** for debugging commands and architecture details.

### Status & Monitoring

The server exposes a live status API and dashboard:

- `GET /api/status` — Machine-readable JSON with:
  - Storage mode (`valkey` or `in-memory`), `ttlMs`, masked `VALKEY_URL`
  - Process info: `pid`, Node version, `uptimeSeconds`, `memory` (RSS/heap), `loadavg`
  - WebSocket: `connectedClients`
  - Sessions: `count`, `byType`, `approxTotalBytes`, and detailed `list` with per-session
    `id`, `type`, `created`, `lastActivity`, `ttlRemainingMs`, `expiresAt`, `socketCount`, `approxBytes`
  - Valkey (when enabled): `ping`, `dbsize`, selected memory metrics parsed from `INFO memory`

- `GET /status` — Lightweight HTML dashboard that auto-refreshes by polling `/api/status`.
  - Refresh interval controls (2s/5s/10s/30s) with Pause/Resume
  - Summary cards (mode/TTL, uptime, RSS/heap, sockets, sessions)
  - Sessions-by-type breakdown and Valkey block
  - Table of active sessions with expiry and socket counts

Notes:
- Valkey URL is masked in output to avoid leaking credentials
- Per-session TTL uses Valkey `PTTL` when available; falls back to `lastActivity + ttlMs` in memory mode
- Designed to be low overhead; avoids heavy Valkey `INFO` sections

### Local Development (without container)

From the project root:

Install dependencies:
```bash
npm install --include=dev
```

Start the dev server:
```bash
npm run dev
```

> ⚠️ **Important:** Connect to the **Express server on port 3000**, _not_ the Vite port (5173). Codespaces may automatically open the wrong one.

---

## 🚀 Production (via Render)

### Quick Deploy

This project can be deployed directly on [Render](https://render.com) with persistent session storage using Valkey (Redis-compatible).

**Two Deployment Modes:**

1. **In-Memory Mode** (Simple, no persistence)
   - Sessions lost on restart
   - No external dependencies
   - Good for testing

2. **Valkey Mode** (Recommended for production)
   - Sessions survive hot redeployments
   - Supports horizontal scaling
   - Automatic when `VALKEY_URL` is set

### Basic Setup

Build Command:
```bash
npm run deploy
```

Start Command:
```bash
npm run start
```

**Required Environment Variables:**
```
NODE_ENV=production
PERSISTENT_SESSION_SECRET=<your-random-32-char-secret>
```

**Optional (for persistence):**
```
VALKEY_URL=<your-render-redis-internal-url>
```

### Full Deployment Guide

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for:
- Complete Render setup instructions
- Valkey configuration
- Horizontal scaling with sticky sessions
- Environment variables reference
- Monitoring and troubleshooting
- Security best practices

### Pre-deploy check (local)

Run the same steps Render uses to catch missing dependencies before pushing:
```bash
npm test
```
This installs all workspaces, performs a production build, starts the server, and confirms it boots via `/health-check`.
