# SyncDeck Plan Checklist

Use this checklist to track implementation progress for SyncDeck. Update this file as tasks are completed.

## Core Setup

- [x] Activity registered (`syncdeck`) with manager/student entries
- [x] Session schema + normalizer in place (`presentationUrl`, `instructorPasscode`, students, etc.)
- [x] SyncDeck routes + websocket namespace implemented
- [x] Basic activity tests wired into workspace test runs

## Security & Validation

- [x] Signed persistent URL flow (`urlHash`) implemented and verified server-side
- [x] URL validation hardened on server (http/https only, no creds/private-host targets)
- [x] Student identity cookie is signed + tamper-checked
- [x] Student rejoin reuses identity from valid cookie
- [x] Secret-warning behavior improved for short dev secrets (single warning path)
- [x] Added test for secret warning behavior

## Instructor / Permalink Flow

- [x] Instructor passcode retrieval route for persistent sessions
- [x] Waiting-room teacher auth sets persistent cookie before start path
- [x] Waiting-room teacher path can start session without prior cookie
- [x] SyncDeck manager avoids blocking preflight on signed permalink startup
- [x] Verify manually end-to-end: teacher with no cookie always lands directly in active presentation flow

## Realtime Sync Behavior

- [x] Instructor role/setRole command on iframe load
- [x] Student role/setRole command on iframe load
- [x] State snapshot persistence + reconnect replay hardened
- [x] Replay uses command-shaped `setState` payloads
- [x] Boundary semantics implemented (set/clear/effective max rules)
- [x] Student backtrack opt-out + force-sync reset + fast-forward action

## Dashboard Architecture

- [x] Removed activity-specific preflight logic from shared dashboard
- [x] Added generic activity-declared preflight contract
- [x] SyncDeck now declares preflight in activity config

## UX / Accessibility

- [x] Connection status indicator improved to live-region semantics
- [x] Debug logging cleanup completed
- [x] Add explicit UI copy for permalink-authenticated instructor auto-start

## Verification & Release Readiness

- [x] Client tests/lint/build passing after refactors
- [x] Activities/server tests passing
- [ ] Run final `npm test` before push/PR update
- [ ] Update PR description/checklist with done vs follow-up items
