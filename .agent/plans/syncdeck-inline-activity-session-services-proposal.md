# Proposal: Presentation-Local Activity Session Services For SyncDeck

## Summary

SyncDeck already supports embedded ActiveBits activities by letting Reveal decks declare launch intent with `data-activity-*` attributes. The host then owns child-session lifecycle, session creation, participant handoff, and activity launch.

This proposal is for a different class of interaction: activities authored directly inside the presentation itself. Deck-local JavaScript should be able to opt into narrowly scoped SyncDeck session services without becoming an ActiveBits activity, creating a child session, or depending on the ActiveBits activity registry.

The core abstraction is an isolated service channel. A presentation-owned widget can declare a channel for a specific local activity instance, and SyncDeck can relay or persist only the state that belongs to that parent session and channel.

The goal is to support a spectrum of classroom interactions:

- local-only student activities that survive reloads, if the host later supports private restore state
- shared activities where students exchange or submit events
- instructor-visible progress and checkpoints
- instructor-controlled shared state such as timers, phases, random seeds, or released challenges
- eventual dashboard views for activity progress and shared classroom state

The motivating first service is a synchronized timer. When the instructor starts a deck-local timer, all viewers should derive the same remaining time from canonical SyncDeck state. The timer should not become an embedded ActiveBits activity just to synchronize.

## Motivation

Course decks increasingly include JavaScript interactions directly in the presentation. For example, a cybersecurity deck might include a public/private key lab where students drag keys, encrypt messages, verify signatures, and receive step-by-step feedback.

Some of these interactions should remain private and local to each student. Others would benefit from session awareness:

- a timer should start, pause, resume, and finish at the same time for instructor and students
- an instructor might broadcast a challenge prompt to all students
- students might submit an encrypted or signed response
- a paired activity might allow students to exchange public keys or messages
- the instructor might want aggregate progress such as "24 of 29 students completed step 2"
- late joiners or refreshed browsers should restore the current activity state

Without a shared SyncDeck service layer, each deck-local activity must either remain isolated or invent its own messaging scheme. That creates duplicated logic and inconsistent behavior across courses.

## Non-Goals

- Do not create ActiveBits child sessions.
- Do not route students into `/activity`, `/manage`, waiting-room, or child-session entry flows.
- Do not register presentation-local activities in the ActiveBits activity registry.
- Do not multiplex full ActiveBits activity websocket traffic through SyncDeck.
- Do not give deck-authored code direct access to raw SyncDeck session records.
- Do not use `session.data.embeddedActivities` for presentation-local activity state.

## Relationship To Embedded Activities

This proposal does not replace the existing embedded ActiveBits activity flow.

Embedded ActiveBits activities should continue to use:

- `data-activity-id`
- `data-activity-trigger`
- `data-activity-options`
- `activityRequest`
- host-owned launch and child session lifecycle
- child activity websocket and report routes

Presentation-local activity services are for interactions that live inside the Reveal deck itself. They are useful when the activity is small, tightly coupled to slide content, or only needs narrow host services such as shared timers, state replay, or progress aggregation.

The two systems should remain parallel:

- Embedded ActiveBits activity: registered app, child session, activity-owned runtime.
- Presentation-local activity: deck-owned code, parent session service channel, SyncDeck-owned synchronization.

A deck-local timer should not be represented as an embedded child session, and an embedded ActiveBits activity should not depend on the presentation-local service channel.

## Design Principles

1. Decks describe intent; the host owns orchestration.
2. Presentation-local activity APIs should be generic and activity-agnostic.
3. Activities must continue to work in standalone Reveal preview mode.
4. Local student state and shared classroom state should be clearly separate.
5. Timers and other shared state should sync canonical state, not high-frequency UI updates.
6. The protocol should use stable local identity based on `localActivityId`, `instanceKey`, and optional slide `location`.
7. The host should decide routing, persistence, permissions, and dashboard display.
8. Existing embedded activity contracts should remain unchanged.

## Proposed Concept

Add a presentation-local activity service layer inside SyncDeck with isolated channels. Each channel belongs to one parent SyncDeck session and one deck-local activity instance.

Suggested persisted namespace:

```ts
session.data.presentationLocalActivities = {
  [channelKey: string]: {
    localActivityId: string
    instanceKey: string
    location?: { h: number; v: number; f?: number }
    updatedAt: number
    sharedState?: Record<string, unknown>
    timer?: {
      status: 'idle' | 'running' | 'paused'
      durationMs: number
      startedAt: number | null
      pausedAt: number | null
      elapsedBeforePauseMs: number
    }
  }
}
```

`channelKey` should be derived by the server from normalized inputs rather than trusted directly from the iframe. A good starting shape is:

```ts
`${localActivityId}:${instanceKey}`
```

This namespace is intentionally separate from `session.data.embeddedActivities`.

Add a browser API exposed by the SyncDeck Reveal runtime:

```js
window.SyncDeckSession
```

This API would sit above the existing `RevealIframeSyncAPI.sendCustom(...)` mechanism and provide deck authors with small, structured services.

At a high level:

- presentation-local activities register themselves with the host
- activities can store local state
- activities can emit progress or shared events
- activities can subscribe to host-relayed events or state updates
- shared utilities, especially timers, can be controlled by the instructor and rendered consistently across all participants

## Example Authoring API

### Register A Presentation-Local Activity

```js
const keyLab = SyncDeckSession.activities.register({
  localActivityId: 'public-private-key-lab',
  instanceKey: 'public-private-key-lab:6:0',
  title: 'Public/Private Key Lab',
  visibility: 'instructor',
  capabilities: ['localState', 'progress', 'sharedEvents']
});
```

The runtime should derive useful defaults when possible:

- `location` from `Reveal.getIndices()`
- `instanceKey` from `localActivityId:h:v` if not supplied
- role/session support from the SyncDeck host handshake

### Local Student State

```js
keyLab.local.set({
  selectedStep: 'decrypt-response',
  completedSteps: ['encrypt-message'],
  attempts: {
    'encrypt-message': 2
  }
});

keyLab.local.onRestore((state) => {
  restoreKeyLabUi(state);
});
```

Local state is private to the student by default. The host may persist it for restore, but it should not be broadcast to classmates.

### Progress Events

```js
keyLab.progress.emit({
  checkpoint: 'encrypt-message',
  status: 'complete'
});
```

The host can aggregate this for instructor-facing views.

### Shared Activity Events

```js
keyLab.events.send('message-submitted', {
  ciphertext: 'Q7F2-19AC',
  signed: true
});

keyLab.events.on('challenge-broadcast', (event) => {
  renderChallenge(event.payload);
});
```

The host decides whether events go to:

- instructor only
- all students
- a group
- a specific partner
- no one, if the current role is not allowed

### Shared Timers

```js
const timer = SyncDeckSession.timers.get('discussion-timer');

timer.start({
  durationMs: 180000,
  label: 'Partner discussion'
});

timer.onChange((state) => {
  renderTimer(state);
});
```

Timer state should sync canonical timestamps rather than remaining seconds:

```json
{
  "id": "discussion-timer",
  "status": "running",
  "startedAt": 1778240000000,
  "durationMs": 180000,
  "pausedAt": null,
  "elapsedBeforePauseMs": 0,
  "serverNow": 1778240060000
}
```

Each iframe computes display time locally from the canonical state. This keeps students aligned without sending updates every second.

Student-originated timer control should be rejected unless a future capability explicitly allows student-owned channels.

## Proposed Message Types

These would be host-facing messages sent through the existing `reveal-sync` envelope.

### `presentationLocalActivity:declare`

Sent when a presentation-local activity declares an isolated channel.

```json
{
  "type": "reveal-sync",
  "action": "presentationLocalActivity:declare",
  "deckId": "protecting-data",
  "role": "student",
  "payload": {
    "localActivityId": "public-private-key-lab",
    "instanceKey": "public-private-key-lab:6:0",
    "title": "Public/Private Key Lab",
    "location": { "h": 6, "v": 0, "f": -1 },
    "capabilities": ["localState", "progress", "sharedEvents"]
  }
}
```

### `presentationLocalActivity:event`

Sent when deck-local code emits an event.

```json
{
  "type": "reveal-sync",
  "action": "presentationLocalActivity:event",
  "deckId": "protecting-data",
  "role": "student",
  "payload": {
    "localActivityId": "public-private-key-lab",
    "instanceKey": "public-private-key-lab:6:0",
    "event": "message-submitted",
    "scope": "instructor",
    "payload": {
      "ciphertext": "Q7F2-19AC",
      "signed": true
    }
  }
}
```

### `presentationLocalActivity:localState`

Sent when a student activity updates private restore state.

```json
{
  "type": "reveal-sync",
  "action": "presentationLocalActivity:localState",
  "deckId": "protecting-data",
  "role": "student",
  "payload": {
    "localActivityId": "public-private-key-lab",
    "instanceKey": "public-private-key-lab:6:0",
    "state": {
      "completedSteps": ["encrypt-message"]
    }
  }
}
```

### `presentationLocalActivity:sharedStateSet`

Sent when authorized deck code requests an update to shared state for its isolated channel.

```json
{
  "type": "reveal-sync",
  "action": "presentationLocalActivity:sharedStateSet",
  "deckId": "protecting-data",
  "role": "instructor",
  "payload": {
    "localActivityId": "discussion-tools",
    "instanceKey": "discussion-tools:4:0",
    "key": "timer:discussion-timer",
    "value": {
      "status": "running",
      "startedAt": 1778240000000,
      "durationMs": 180000,
      "pausedAt": null,
      "elapsedBeforePauseMs": 0
    }
  }
}
```

### `presentationLocalActivity:sharedState`

Sent by the host to iframes when shared state changes or when a participant joins late.

```json
{
  "type": "reveal-sync",
  "action": "command",
  "payload": {
    "name": "presentationLocalActivity:sharedState",
    "localActivityId": "discussion-tools",
    "instanceKey": "discussion-tools:4:0",
    "key": "timer:discussion-timer",
    "value": {
      "status": "running",
      "startedAt": 1778240000000,
      "durationMs": 180000,
      "pausedAt": null,
      "elapsedBeforePauseMs": 0,
      "serverNow": 1778240060000
    }
  }
}
```

## Permissions And Routing

The host should enforce routing and mutation rules. Suggested defaults:

| Capability | Instructor | Student |
| --- | --- | --- |
| Declare local activity channel | yes | yes |
| Write local private state | yes | yes |
| Emit progress | yes | yes |
| Read aggregate progress | yes | no |
| Start/pause/reset shared timer | yes | no, unless delegated |
| Read shared timer | yes | yes |
| Broadcast event to all | yes | no, unless delegated |
| Submit event to instructor | yes | yes |
| Send peer/group event | configurable | configurable |

Deck authors should be able to request a scope, but the host should be authoritative.

Suggested event scopes:

- `local`
- `instructor`
- `all`
- `group`
- `partner`
- `host`

## Privacy And Safety

Presentation-local activities may collect student work or behavior. The API should make data classification explicit:

- local private state
- progress metadata
- student submission
- shared classroom state
- instructor broadcast

The host should avoid broadcasting private local state. Student submissions should be routed according to host policy, and dashboard displays should distinguish aggregate progress from visible student work.

The iframe is deck-authored code, so messages are still untrusted input. The server should validate and bound every payload before persistence or broadcast.

The host should enforce:

- maximum channels per SyncDeck session
- maximum serialized state size per channel
- maximum timer duration
- maximum string lengths for ids and state fields
- explicit rejection of unknown capabilities or unauthorized scopes
- pruning for stale channels if needed

## Websocket Behavior

SyncDeck parent websocket remains the transport for presentation-local service events because the activity lives inside the presentation iframe and does not have its own ActiveBits session.

This is different from embedded ActiveBits activities, where the parent websocket carries lifecycle envelopes and the child activity owns its realtime connection.

Expected behavior:

- instructor command arrives through the manager host
- server validates role and channel identity
- server persists canonical channel state
- server broadcasts the channel update to connected SyncDeck viewers
- manager and student hosts forward the scoped update into their presentation iframes
- new or reconnecting viewers receive replayed channel state after SyncDeck websocket authentication or registration

## Storage And Cleanup

Presentation-local activity state should live and expire with the parent SyncDeck session. Ending a SyncDeck session removes the local channel state automatically because it is part of the parent session data.

No child-session TTL coupling is needed.

## Standalone Behavior

Decks must still run outside SyncDeck, including direct browser preview and VS Code preview.

In standalone mode:

- `SyncDeckSession` may exist as a no-op/local-only shim
- local state can use in-memory storage or browser storage if enabled by the deck
- shared events should not throw errors
- timers can run locally
- methods should return predictable results such as `{ supported: false }` or resolve without network effects

Example:

```js
if (!SyncDeckSession.supported) {
  startLocalTimer();
}
```

## Candidate Use Cases

### Synchronized Timers

Deck-authored timers can be controlled by the instructor and displayed consistently across instructor and student views.

Important implementation detail: sync timer state, not per-second ticks.

### Public/Private Key Lab

Local mode:

- student drags keys
- student sees local feedback
- local progress restores after reload

Shared mode:

- instructor sees aggregate progress
- instructor broadcasts a message to encrypt or verify
- students submit encrypted or signed artifacts
- optional partner mode exchanges public keys or challenge messages

### Warm-Up And Exit Ticket Widgets

For quick prompts that do not need the full embedded Resonance activity flow, deck-local code can collect lightweight status or short responses.

### Student-Controlled Simulations

Students can manipulate local parameters while the instructor sees completion or checkpoint signals.

### Released Challenge Phases

The instructor can move a class through shared phases:

- setup
- attempt
- discuss
- reveal
- debrief

Each phase is shared state, and deck UI can respond to phase changes.

## Implementation Roadmap

### Phase 1: Instructor-Owned Broadcast Channels And Timers

- Add shared SyncDeck types for presentation-local activity channel messages.
- Add a `presentationLocalActivities` normalizer to SyncDeck session data.
- Add server helpers to normalize `localActivityId`, `instanceKey`, timer state, and state patches.
- Add instructor-only websocket handling for shared timer commands.
- Broadcast and replay timer state to instructor and student sockets.
- Add manager/student host code that forwards scoped channel updates into the Reveal iframe.
- Provide a standalone no-op/local shim.
- Add tests for timer start/replay, rejected student mutation, payload limits, session isolation, and no interaction with `embeddedActivities`.

### Phase 2: Local State And Progress

- Add student-private local restore state if persistence is needed.
- Add progress event ingestion with aggregate instructor views.
- Keep raw student work and aggregate progress as separate data classes.

### Phase 3: Optional Event Routing

- Add controlled event scopes such as `instructor`, `all`, `group`, or `partner`.
- Add explicit capability gates before students can broadcast or peer-route events.
- Revisit reporting and scoring only after the channel model is stable.

## Open Questions

- Should deck-local activities be allowed to create student-private state in phase one, or should phase one be instructor-owned broadcast state only?
- Should shared state updates be full replacement, shallow patch, or operation-based?
- Should channel declarations be required before updates, or can updates implicitly create channels?
- Should the deck runtime expose one generic channel API, or separate helpers such as `createSyncedTimer(...)`?
- How much of this should be available in standalone presentation preview outside a live SyncDeck session?
- Should channel identity include a deck or presentation identifier beyond the parent SyncDeck session and `instanceKey`?

## Definition Of Done

- Presentation-local activity service state is clearly separate from embedded ActiveBits activity state.
- A deck-local timer can be started by the instructor and stays synchronized across manager and student presentation iframes.
- Late joiners receive current timer state.
- Student-originated instructor-only mutations are rejected.
- Payload limits and validation prevent deck-authored messages from writing arbitrary or unbounded session data.
- Existing embedded activity behavior and tests continue to pass.
