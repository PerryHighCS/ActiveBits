# ActiveBits Development with Valkey

The dev container is configured to use Valkey (Redis-compatible) for session storage and pub/sub.

## Valkey Connection

The `VALKEY_URL` environment variable is automatically set to `redis://valkey:6379` in the dev container.

### Testing the Connection

```bash
# Test Valkey connection (using redis-cli - fully compatible)
redis-cli -h valkey ping

# View keys (use SCAN to avoid blocking)
redis-cli -h valkey scan 0

# Monitor commands in real-time
redis-cli -h valkey monitor

# Get server info
redis-cli -h valkey info
```

## Running the Server

The server automatically detects and uses Valkey when `VALKEY_URL` is set:

```bash
# Start the server (uses Valkey automatically)
cd server
npm run dev

# Or start without Valkey (in-memory only)
unset VALKEY_URL
npm run dev
```

## Architecture

- **Session Storage**: Sessions are stored in Valkey with automatic TTL management
- **Pub/Sub**: Cross-instance communication for horizontal scaling
- **Persistent Sessions**: Long-lived teacher sessions stored in Valkey
- **Cache Layer**: In-memory cache reduces Valkey round-trips for frequent operations

See `server/core/valkeyStore.js` for implementation details.

## Debugging

To view session data:

```bash
# List all session keys
redis-cli -h valkey scan 0 match 'session:*'

# Get specific session
redis-cli -h valkey get 'session:SESSIONID'

# View persistent sessions
redis-cli -h valkey scan 0 match 'persistent:*'
```

## Status Endpoints (Local)

While developing, use the built-in status endpoints:

```bash
# JSON status (machine-readable)
curl -s http://localhost:3000/api/status | jq .

# HTML dashboard
"$BROWSER" http://localhost:3000/status
```

What to expect in Valkey mode:
- `storage.mode` should be `valkey`
- `valkey.ping` returns `PONG`
- `sessions.list[*].ttlRemainingMs` aligns with Valkey `PTTL`

In in-memory mode:
- `storage.mode` is `in-memory`
- TTL derived from `lastActivity + ttlMs`
