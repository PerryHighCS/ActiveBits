# Iframe Sync Protocol Notes

Use this file when wiring or debugging host-to-iframe communication for a SyncDeck Reveal deck.

## Message Envelope

All messages use a shared envelope with fields like:

- `type`
- `version`
- `action`
- `deckId`
- `role`
- `source`
- `ts`
- `payload`

Typical values:

- `type: "reveal-sync"`
- `source: "reveal-iframe-sync"`

## Common Host Commands

The most important commands to support are:

- `next`
- `prev`
- `slide`
- `setState`
- `setRole`
- `pause`
- `resume`
- `toggleOverview`
- `showOverview`
- `hideOverview`
- `allowStudentForwardTo`
- `setStudentBoundary`
- `clearBoundary`
- `syncToInstructor`

## Critical Behaviors

### Role Control

- default role is standalone
- the host should promote the iframe to `instructor` or `student`
- do not rely on static config alone for runtime role changes

### Standalone Launch

The standalone "Activate SyncDeck" CTA is outside the iframe command protocol.

- opt in with `standaloneHosting.activeBitsOrigin`
- the runtime redirects to ActiveBits under `/util/syncdeck/launch-presentation`
- pass a canonical absolute deck URL as `presentationUrl` when needed

### Boundary Control

Student forward navigation may be constrained by an explicit boundary.

Important expectations:

- boundary-setting commands override follow-instructor auto-advance
- clearing the boundary returns the student to follow-instructor mode
- `syncToInstructor` is the clean single-command way to snap back to the instructor state and re-enter follow mode

### Overview Control

Overview commands should drive the custom storyboard strip, not Reveal's built-in grid overview.

### Pause Semantics

When the host pauses a student deck, local student unpause attempts should not silently override that host-owned pause lock.

## Deck Wiring Checklist

- load `reveal-iframe-sync.js`
- register `RevealIframeSync` in `Reveal.initialize({ plugins: [...] })`
- supply a unique `deckId`
- align `hostOrigin` and `allowedOrigins` with the host policy
- confirm the iframe posts a `ready` message on connect

## Most Common Broken States

- script loaded but plugin not registered
- host targets the wrong `deckId`
- origin policy blocks messages
- deck tries to manage instructor/student role transitions locally
- deck uses Reveal overview instead of the custom storyboard contract
