# Video Sync Activity Plan

This plan is to build a standalone ActiveBits activity for synchronized video playback. Presentation embedding is explicitly out of scope for this phase and should be tracked as future work under the SyncDeck embedded-activities plan in [`.agent/plans/syncdeck.md`](/workspaces/ActiveBits/.agent/plans/syncdeck.md).

## Goal

Create a new activity, tentatively `video-sync`, that lets an instructor control shared video playback for a class from within ActiveBits.

## Scope

In scope for this plan:
- Add a new self-contained activity under `activities/video-sync/`
- Support instructor-led synchronization for play, pause, seek, and playback position updates
- Support solo mode for student self-paced practice with no teacher-managed session orchestration
- Provide manager and student views that work within the standard ActiveBits session model
- Keep activity state and protocol activity-specific rather than coupling it to SyncDeck presentation internals
- Use TypeScript for new or modified application code

Out of scope for this phase:
- Embedding the activity inside SyncDeck presentations
- Slide-triggered video launches
- Parent/child session linkage between SyncDeck and a video activity
- Multi-activity orchestration or reporting for embedded runs

## Why This Direction

- It keeps video synchronization aligned with the ActiveBits activity boundary instead of adding more presentation-specific behavior to SyncDeck.
- It makes the feature reusable outside presentations.
- It reduces coupling between Reveal iframe protocol work and future synchronized media work.
- It leaves a cleaner path to future embedding once the embedded-activities model is specified.

## Proposed Activity Shape

Activity structure:
- `activities/video-sync/activity.config.ts`
- `activities/video-sync/client/index.ts`
- `activities/video-sync/client/manager/`
- `activities/video-sync/client/student/`
- `activities/video-sync/server/routes.ts`
- activity-specific tests for client and server behavior

Expected runtime model:
- Instructor creates/configures a `video-sync` session from the manager view
- Session stores normalized video state such as source URL, current time, paused/playing state, last sync timestamp, and any access restrictions
- Students join the normal ActiveBits session URL and receive the synchronized playback state
- Instructor actions broadcast updated state through activity-owned APIs and websocket/session update paths
- Solo mode is separate and student self-paced (`/solo/video-sync` style flow) with no live classroom session dependency

## Activity Config Alignment (per Adding Activities)

- Define metadata in `activities/video-sync/activity.config.ts` as source of truth (id/name/description/color/soloMode/clientEntry/serverEntry)
- Set `soloMode: true` so the activity appears in Solo Bits
- Optionally set `soloModeMeta` labels for dashboard and join-page clarity
- Keep the client entry side-effect free and export `ManagerComponent`, `StudentComponent`, and `footerContent`
- For synchronized classroom mode, keep manager/student session behavior in the regular activity flow
- For solo mode, follow self-paced semantics (no teacher orchestration and no requirement for synchronized classroom session transport)

## Functional Requirements

- Instructor can provide and update the video source for a session using standard `youtube.com/watch` and `youtu.be` URLs
- Instructor can set start and stop timestamps (stop is advisory, not hard-enforced)
- Instructor can play, pause, and seek the shared video
- Students follow instructor playback state with drift correction target of `0.75s` tolerance
- Late-joining students receive the current synchronized state
- Late-joining students auto-seek and attempt autoplay; if autoplay is blocked, they receive a click-to-start fallback and can rely on the classroom display
- Session reload/reconnect restores enough state to resume synchronization
- Student playback control is disabled in synchronized sessions and enabled in solo mode
- Server-side validation rejects invalid session state and malformed configuration requests
- Manager dashboard surfaces connection status, synchronization errors, and unsync events

## Design Notes

- Prefer a simple activity-specific synchronization contract over extending the Reveal iframe message schema
- Register a session normalizer for `video-sync` so persisted sessions recover safely after restart or cache reload
- Keep student controls constrained to the intended classroom model; synchronized sessions are instructor-only controlled, with solo mode as the explicit exception
- Keep student controls constrained to the intended classroom model; synchronized sessions are instructor-only controlled, while solo mode is student self-paced without teacher orchestration
- Restrict initial source support to YouTube URLs (`youtube.com/watch`, `youtu.be`) and normalize to `videoId`, `startSec`, and optional `stopSec`
- Use YouTube privacy-enhanced embed domain (`youtube-nocookie.com`) unless platform constraints prove incompatible
- Treat configured stop time as advisory UX behavior (auto-pause when reached) rather than a hard server-enforced boundary

## YouTube v1 Provider Policy

- Accepted URL families: `https://www.youtube.com/watch?...` and `https://youtu.be/...`
- Parse and normalize start timestamp from URL params (`t` or `start`) into `startSec`
- Allow optional stop timestamp (`end` param or explicit manager input) into `stopSec`
- Playlist URLs, Shorts URLs, and non-YouTube providers are out of scope for v1
- Store canonical source as normalized fields (`videoId`, `startSec`, `stopSec?`) rather than raw URL-only state
- Render embeds via `youtube-nocookie.com` and keep this as the default unless validated blockers appear

## Default Decisions (Resolved)

- Embed domain: default to `youtube-nocookie.com`; if critical player API incompatibility is observed in target environments, fall back to standard YouTube embed domain behind an activity-level compatibility switch
- Embed fallback trigger: treat repeated player-init failure (`onReady` missing after 8s timeout) or missing essential state-change events in two consecutive load attempts as compatibility failure and switch to standard YouTube embed domain for that session
- Autoplay behavior on late join: auto-seek and attempt autoplay; if blocked, show click-to-start prompt and keep sync telemetry reporting unsynced/autoplay-blocked status to manager dashboard
- Stop timestamp semantics: advisory `stopSec` triggers local auto-pause when playback reaches threshold; no hard server enforcement and no seek lockout
- Heartbeat cadence: websocket event-driven updates plus heartbeat every `3000ms`
- Unsync reporting threshold: report unsync when absolute drift exceeds `2.0s` for two consecutive heartbeat intervals; include correction attempt outcome in telemetry
- Solo mode product definition: student self-paced mode with no teacher-managed classroom session dependency; synchronized session APIs are not required for solo-only operation
- Telemetry schema default: manager dashboard consumes `connections.activeCount`, `autoplay.blockedCount`, `sync.unsyncEvents`, `sync.lastDriftSec`, `sync.lastCorrectionResult`, and latest `error.code/error.message`

## API / Protocol Contract (Draft)

This section defines a minimal activity-specific contract for v1.

Synchronized classroom mode and solo mode are intentionally separate:
- Synchronized mode uses server session state + websocket updates.
- Solo mode is self-paced and does not require the synchronized session protocol.

### Canonical Session State

```ts
type VideoSyncSessionState = {
	provider: 'youtube';
	videoId: string;
	startSec: number;
	stopSec?: number;
	positionSec: number;
	isPlaying: boolean;
	playbackRate: 1;
	updatedBy: 'manager' | 'system';
	serverTimestampMs: number;
};
```

### Manager Configuration Request (example)

`PATCH /api/activity/video-sync/session/:sessionId`

```json
{
	"sourceUrl": "https://youtu.be/dQw4w9WgXcQ?t=43",
	"stopSec": 120,
	"mode": "synchronized"
}
```

### Manager Playback Command (example)

`POST /api/activity/video-sync/session/:sessionId/command`

```json
{
	"type": "seek",
	"positionSec": 87.25
}
```

Other commands:
- `{"type":"play"}`
- `{"type":"pause"}`

### Student Sync Payload (websocket broadcast example)

```json
{
	"event": "video-sync:update",
	"sessionId": "abc123",
	"state": {
		"provider": "youtube",
		"videoId": "dQw4w9WgXcQ",
		"startSec": 43,
		"stopSec": 120,
		"positionSec": 87.25,
		"isPlaying": true,
		"playbackRate": 1,
		"updatedBy": "manager",
		"serverTimestampMs": 1772233344556
	},
	"heartbeat": false
}
```

### Heartbeat Sync Payload (example)

```json
{
	"event": "video-sync:update",
	"sessionId": "abc123",
	"state": {
		"positionSec": 90.00,
		"isPlaying": true,
		"serverTimestampMs": 1772233347556
	},
	"heartbeat": true
}
```

### Validation Error Examples

- Invalid source URL

```json
{
	"error": "INVALID_SOURCE_URL",
	"message": "Only youtube.com/watch and youtu.be URLs are supported in v1."
}
```

- Missing or unparseable YouTube video id

```json
{
	"error": "INVALID_VIDEO_ID",
	"message": "Could not determine a valid YouTube video id from sourceUrl."
}
```

- Invalid timestamp bounds

```json
{
	"error": "INVALID_TIME_RANGE",
	"message": "stopSec must be greater than startSec and both must be >= 0."
}
```

- Unauthorized student command in synchronized mode

```json
{
	"error": "FORBIDDEN_COMMAND",
	"message": "Students cannot control playback in synchronized mode."
}
```

### Solo Mode Local State (example)

```ts
type VideoSyncSoloState = {
	provider: 'youtube';
	videoId: string;
	startSec: number;
	stopSec?: number;
	positionSec: number;
	isPlaying: boolean;
	playbackRate: 1;
	updatedAtMs: number;
};
```

Suggested persistence key pattern:
- `video-sync-solo-state-solo-video-sync`

## Implementation Phases

### Phase 1: Activity contract
- Define session data shape and normalization rules
- Define manager-to-server configuration/update endpoints
- Define server-to-student synchronization payloads
- Use event-driven websocket broadcast plus periodic heartbeat updates
- Define authorization rules for synchronized mode control and separate solo-mode local behavior
- Exit criteria: validated synchronized state schema + endpoint contracts + role control rules documented and testable; solo-mode local-state contract documented

### Phase 2: Minimal vertical slice
- Scaffold the new activity
- Build a manager UI for configuring the video and basic playback controls
- Build a student UI that renders the synchronized player
- Build student self-paced solo mode flow aligned with Solo Bits behavior
- Add tests covering session creation, validation, normalization, and state updates
- Exit criteria: manager can configure YouTube source/start/stop and students receive synchronized playback updates; solo mode works without teacher session orchestration

### Phase 3: Synchronization hardening
- Add reconnect/late-join recovery behavior
- Handle seek/play/pause edge cases and `0.75s` drift tolerance correction behavior
- Add validation and structured logging for synchronization failures
- Verify behavior under temporary disconnections and refreshes
- Add manager dashboard visibility for connections, errors, and unsync events
- Exit criteria: reconnect and late join behavior validated; telemetry visible to manager for key failure states

## Test Matrix (Mapped to Requirements)

| Requirement | Unit Tests | Integration Tests | E2E/Scenario Tests |
| --- | --- | --- | --- |
| YouTube URL input and normalization | URL parser accepts `youtube.com/watch` + `youtu.be`; rejects unsupported hosts and malformed ids | Config route persists normalized `videoId/startSec/stopSec` | Manager enters URL and sees normalized playback start |
| Start/stop timestamp behavior | Timestamp parsing for `t/start/end`, `stopSec > startSec` validation | Session state includes advisory `stopSec`; update route enforces bounds | Playback reaches stop and auto-pauses without hard lockout |
| Instructor play/pause/seek synchronization | Command reducer updates canonical state and timestamps | Command endpoint emits websocket update + heartbeat continuity | Manager controls are reflected on students with expected timing |
| Student restrictions in synchronized mode | Authorization helper rejects student commands | Command route returns `FORBIDDEN_COMMAND` for student actor in synchronized mode | Student UI controls disabled in synchronized mode |
| Solo mode behavior | Solo state store validates local shape and defaults | Solo route loads without synchronized session API dependencies | Student opens solo link and plays self-paced video with local persistence |
| Late join/reconnect recovery | Drift calculator and catch-up logic with `0.75s` threshold | Join flow receives latest state snapshot and heartbeat updates | Late student joins, auto-seeks; autoplay-block path shows click-to-start fallback |
| Validation and error handling | Schema/validator tests for invalid URL/time/command payloads | Routes return deterministic error codes/messages | Manager sees actionable error state in dashboard |
| Telemetry visibility | Event formatter emits structured payloads for connection/error/unsync | Server logs and manager feed include expected event categories | Manager dashboard shows connection count and sync health changes |

## Risks / Open Questions

| Topic | Risk or Question | Owner | Decision Deadline |
| --- | --- | --- | --- |
| Cross-browser autoplay variance | Some browser/device combinations may still require manual start more often than expected despite fallback UX | Activity implementer | During Phase 3 hardening |
| Classroom network jitter spikes | Temporary local network issues can increase unsync event frequency and telemetry noise | Activity implementer + dashboard owner | During Phase 3 hardening |

## Progress Snapshot (2026-03-01)

- Completed: activity scaffold (`activity.config.ts`, client entry, manager/student views, server routes)
- Completed: normalized synchronized session state + solo local-state model
- Completed: websocket envelope contract (`version`, `activity`, `sessionId`, `type`, `timestamp`, `payload`) and heartbeat strategy
- Completed: manager controls (configure, play, pause, seek), student synchronized view, and solo self-paced flow
- Completed: autoplay-block fallback prompt and telemetry event reporting path
- Completed: activity-specific tests + repo-wide validation gate (`npm test`)
- Remaining: explicit cross-browser `youtube-nocookie.com` compatibility sign-off in target runtime environments

## Checklist

- [x] Confirm the final activity id and display name for the new synchronized video activity
- [x] Finalize YouTube v1 source policy (`youtube.com/watch`, `youtu.be`, start + optional stop)
- [ ] Validate `youtube-nocookie.com` compatibility in target runtime environments
- [x] Create `activities/video-sync/` with config, client entry, and server entry
- [x] Set `soloMode: true` and define `soloModeMeta` labels in activity config
- [x] Define normalized session state for synchronized video playback
- [x] Define synchronized role/permission behavior and separate solo local-state behavior
- [x] Implement instructor session creation/configuration flow
- [x] Implement manager playback controls
- [x] Implement student synchronized playback view
- [x] Implement student self-paced solo mode flow with local persistence
- [x] Implement event-driven sync + heartbeat strategy with `0.75s` drift correction target
- [x] Implement autoplay-block fallback behavior for late joins
- [x] Add manager dashboard reporting for connections, errors, and unsync events
- [x] Add activity-specific tests for server routes, normalization, and client sync behavior
- [x] Run appropriate workspace checks and full repo validation as needed
- [ ] Revisit SyncDeck embedding only after the embedded-activities future plan is ready

## Future Work

Future embedding work should not be designed ad hoc in this activity plan. When ActiveBits is ready to support embedded activities inside presentations, continue in the SyncDeck embedded-activities planning track at [`.agent/plans/syncdeck.md`](/workspaces/ActiveBits/.agent/plans/syncdeck.md).

That later work can address:
- how a SyncDeck slide launches `video-sync`
- how parent and child sessions link together
- how connected students claim seats in the embedded activity
- how instructor ownership/arbitration works
- how embedded activity results are reported back to the presentation context
