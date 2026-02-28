# Video Sync Activity Plan

This plan is to build a standalone ActiveBits activity for synchronized video playback. Presentation embedding is explicitly out of scope for this phase and should be tracked as future work under the SyncDeck embedded-activities plan in [`.agent/plans/syncdeck.md`](/workspaces/ActiveBits/.agent/plans/syncdeck.md).

## Goal

Create a new activity, tentatively `video-sync`, that lets an instructor control shared video playback for a class from within ActiveBits.

## Scope

In scope for this plan:
- Add a new self-contained activity under `activities/video-sync/`
- Support instructor-led synchronization for play, pause, seek, and playback position updates
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

## Functional Requirements

- Instructor can provide and update the video source for a session
- Instructor can play, pause, and seek the shared video
- Students follow instructor playback state with reasonable drift correction
- Late-joining students receive the current synchronized state
- Session reload/reconnect restores enough state to resume synchronization
- Server-side validation rejects invalid session state and malformed configuration requests

## Design Notes

- Prefer a simple activity-specific synchronization contract over extending the Reveal iframe message schema
- Register a session normalizer for `video-sync` so persisted sessions recover safely after restart or cache reload
- Keep student controls constrained to the intended classroom model; if students should not control playback, that should be enforced in both UI and protocol handling
- If external video URLs are allowed, validate supported source types carefully and avoid introducing unsafe embed behavior
- If the first implementation needs a restricted input model, prefer a narrow allowed-source policy over a permissive one

## Implementation Phases

### Phase 1: Activity contract
- Define session data shape and normalization rules
- Define manager-to-server configuration/update endpoints
- Define server-to-student synchronization payloads
- Decide whether transport should be polling, websocket broadcast, or a hybrid approach

### Phase 2: Minimal vertical slice
- Scaffold the new activity
- Build a manager UI for configuring the video and basic playback controls
- Build a student UI that renders the synchronized player
- Add tests covering session creation, validation, normalization, and state updates

### Phase 3: Synchronization hardening
- Add reconnect/late-join recovery behavior
- Handle seek/play/pause edge cases and drift tolerance
- Add validation and logging for synchronization failures
- Verify behavior under temporary disconnections and refreshes

## Checklist

- [ ] Confirm the final activity id and display name for the new synchronized video activity
- [ ] Define the initial allowed video source model
- [ ] Create `activities/video-sync/` with config, client entry, and server entry
- [ ] Define normalized session state for synchronized video playback
- [ ] Implement instructor session creation/configuration flow
- [ ] Implement manager playback controls
- [ ] Implement student synchronized playback view
- [ ] Add activity-specific tests for server routes, normalization, and client sync behavior
- [ ] Run appropriate workspace checks and full repo validation as needed
- [ ] Revisit SyncDeck embedding only after the embedded-activities future plan is ready

## Future Work

Future embedding work should not be designed ad hoc in this activity plan. When ActiveBits is ready to support embedded activities inside presentations, continue in the SyncDeck embedded-activities planning track at [`.agent/plans/syncdeck.md`](/workspaces/ActiveBits/.agent/plans/syncdeck.md).

That later work can address:
- how a SyncDeck slide launches `video-sync`
- how parent and child sessions link together
- how connected students claim seats in the embedded activity
- how instructor ownership/arbitration works
- how embedded activity results are reported back to the presentation context
