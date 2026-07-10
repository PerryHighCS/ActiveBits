# Postboard Plan

## Status: Implemented / PR Review

This document tracks the Postboard activity design and implementation plan. It is intended to
stay aligned with the repository's current activity conventions, the `ActivityConfig` schema,
and the SyncDeck embedded-activity contract.

---

## Problem Statement

Instructors want a classroom board where they can post a single prompt and students can submit
multiple note responses to that prompt. Every student note must be approved by the instructor
before it becomes visible, unless the session is configured for auto-approve.

Postboard must work both as a normal ActiveBits activity and as an embedded activity launched
from SyncDeck.

Key product constraints:

1. One prompt per session for the first release.
2. Student notes can be submitted multiple times per student.
3. Instructor-authored notes are approved immediately.
4. Students only see reaction counts, not who reacted.
5. The instructor can reorder, hide, flag, and react to posts.
6. Instructor views show student names; student views do not.
7. Student display names are collected through the shared waiting-room entry flow.
8. Instructor-only mutations require the activity instructor passcode.

---

## Confirmed Decisions

1. One prompt per session for v1.
2. Instructor-authored posts are always approved immediately.
3. Reaction visibility is counts only.
4. SyncDeck embedding is required and must use the normal embedded child-session contract.
5. The data model should leave room for future multiple prompt/response sets without forcing them
   into the current UI.
6. Postboard should follow the same manager-auth pattern as Resonance, Video Sync, and MobCode:
   generate an instructor passcode at session creation, persist it in session data, bootstrap it
   into the manager view, and require it for all instructor-only REST and websocket actions.
7. Postboard should follow Resonance and Video Sync for identity collection by declaring a required
   `displayName` waiting-room field.
8. Postboard may reuse the Resonance student reaction palette, but reaction identity should remain
   server-internal and student snapshots should expose aggregate counts only.

---

## Goals

- Let an instructor create and control a single prompt per session.
- Let students submit multiple notes in response to that prompt.
- Require instructor approval before student notes appear to the class, unless auto-approve is on.
- Keep student identities visible only to the instructor.
- Allow the instructor to reorder, hide, unhide, flag, and react to notes.
- Allow students to react to visible peer notes using count-based reactions.
- Allow rejected notes to return to the submitting student's editor without exposing them to peers.
- Support prompt and approval-mode bootstrap from signed permalink or SyncDeck embedded launch options.
- Support SyncDeck embedded launch and reconnect behavior.

## Non-Goals

- Multiple active prompts in v1.
- Student-visible reactor identities.
- Threaded replies or comment trees.
- Editing approved or pending student notes after submission; rejected-note revision is a narrow
  owner-only resubmission flow.
- Separate instructor and student reaction systems.
- New shared reaction or note-card components before a second activity proves the abstraction.

---

## User Experience

### Instructor View

1. The instructor opens or creates a session.
2. The instructor enters the single session prompt.
3. The instructor chooses manual approval or auto-approve.
4. Student submissions arrive in a moderation queue when manual approval is enabled.
5. The instructor can:
   - approve or reject queued notes
   - reorder visible notes
   - hide or unhide notes
   - flag notes
   - react to notes

The instructor sees student names and note moderation state.

### Student View

1. Students join the session and see the prompt.
2. Students can submit multiple notes.
3. Students see only approved or auto-approved notes.
4. Student identities on peer posts are hidden.
5. Students can react to visible peer posts.
6. Students see reaction counts only.
7. If a submitted note is rejected, only the submitting student gets the rejected text back for
   editing and resubmission.

### SyncDeck Embedded View

1. SyncDeck can launch Postboard as an embedded child activity.
2. Embedded sessions must preserve the same privacy and moderation rules as standalone sessions.
3. The activity should use the standard embedded-launch bootstrap/session envelope.
4. The activity should not depend on SyncDeck-specific code paths beyond the shared embedded contract.

---

## Scope

### In Scope

- Session prompt creation.
- Student note submission.
- Manual approval and auto-approve.
- Instructor visibility controls.
- Instructor reordering.
- Instructor flagging.
- Instructor and student reactions.
- Anonymous student-facing rendering.
- SyncDeck embedded launch compatibility.
- Session normalization and live updates.
- Instructor passcode generation, recovery, and mutation authorization.
- Waiting-room display-name collection and accepted-entry identity integration.
- Prompt and approval-mode launch options through `selectedOptions`.

### Out of Scope

- Multiple prompt sets in the first release.
- Per-user reaction identity display.
- Direct student-to-student messaging.
- Nested responses or threads.
- New shared embedded-session abstractions beyond the current contract.
- Student-visible author names, moderation history, or reactor identities.
- Generic report/export infrastructure in v1.

---

## Data Model Direction

Postboard should use session data that can evolve without breaking existing sessions.

### Session Data Sketch

```ts
interface PostboardSessionData {
  mode: 'postboard'
  instructorPasscode: string
  prompt: {
    id: string
    text: string
    createdAt: number
    updatedAt: number
  }
  settings: {
    autoApprove: boolean
  }
  posts: PostboardPost[]
  reactions: PostboardReactionState
  flags: Record<string, PostboardFlag[]>
  embeddedLaunch?: Record<string, unknown>
}
```

### Post Sketch

```ts
interface PostboardPost {
  id: string
  promptId: string
  authorId: string
  authorName: string
  authorRole: 'student' | 'instructor'
  text: string
  createdAt: number
  updatedAt: number
  status: 'pending' | 'approved' | 'rejected'
  approvedAt: number | null
  rejectedAt: number | null
  hiddenAt: number | null
  order: number
}
```

Notes:

- `status` is authoritative for moderation state.
- Student-facing visibility is derived from `status === 'approved' && hiddenAt === null`.
- `approvedAt`, `rejectedAt`, and `hiddenAt` are audit fields, not independent visibility flags.
- Rejected posts remain in session data so the submitting student can recover and edit the text,
  but rejected posts are only included in instructor snapshots and owner-only student snapshots.
- Instructor-authored posts are created with `status: 'approved'`, `approvedAt: Date.now()`, and
  `authorRole: 'instructor'`.

### Reactions

Reactions should store per-reactor choices internally and expose counts in student-safe snapshots.
This follows Resonance's reaction semantics: students see aggregate counts, while the server keeps
enough state to prevent repeated clicks from inflating counts and to support toggling/changing a
reaction.

```ts
interface PostboardReactionState {
  [postId: string]: {
    byUser: Record<string, string>
  }
}

interface PostboardReactionCounts {
  [postId: string]: {
    [reactionId: string]: number
  }
}
```

Rules:

- Student reactions are accepted only for visible peer posts.
- Instructor reactions are accepted for any post the instructor can see.
- The palette should start with the same allowed reaction ids as Resonance unless product testing
  shows Postboard needs a smaller set.
- Broadcasts and student REST snapshots must include `PostboardReactionCounts`, not `byUser`.

### Flags

```ts
interface PostboardFlag {
  id: string
  postId: string
  flaggedBy: string
  reason?: string
  createdAt: number
}
```

Flags are instructor-only state. Student snapshots should not expose flag entries or counts.

### Snapshot Direction

Define explicit server builders instead of letting client views filter raw session data:

```ts
interface PostboardInstructorSnapshot {
  prompt: PostboardSessionData['prompt']
  settings: PostboardSessionData['settings']
  posts: PostboardPost[]
  reactionCounts: PostboardReactionCounts
  flags: Record<string, PostboardFlag[]>
}

interface PostboardStudentSnapshot {
  prompt: PostboardSessionData['prompt']
  settings: Pick<PostboardSessionData['settings'], 'autoApprove'>
  posts: Array<Omit<PostboardPost, 'authorId' | 'authorName'> & { authorLabel: 'Instructor' | 'Student' }>
  ownRejectedPosts: PostboardPost[]
  reactionCounts: PostboardReactionCounts
}
```

Student snapshots must not include peer `authorId`, peer `authorName`, flags, instructor passcodes,
raw `reactions.byUser`, or unapproved/hidden peer posts.

### Expansion Note

The current release should remain single-prompt, but the schema should avoid locking the UI
into a shape that would block a later `prompts[]` or `responseSets[]` expansion.

### Pattern References

- Resonance: waiting-room display names, student-safe snapshots, reaction count rendering, and
  `x-instructor-passcode` authorization for instructor routes.
- Gallery Walk: compact note-card UI, stable keys for repeated note cards, and activity-owned
  report/export code if Postboard later needs it.
- Video Sync: canonical `selectedOptions` recovery from persistent links and embedded launch
  bootstrap, without trusting unsigned manage-route query params.
- MobCode: manager passcode bootstrapping through `sessionStorage` plus `historyState`, and
  passcode-verified websocket/REST mutations.

---

## ActivityConfig Direction

Postboard should target the current `ActivityConfig` contract and keep all activity-specific
behavior under `activities/postboard/...`.

Planned config shape:

```ts
const postboardConfig: ActivityConfig = {
  id: 'postboard',
  name: 'Postboard',
  description: 'Collect and moderate student notes on a shared board',
  color: 'teal',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: false,
    supportsPermalink: true,
    showOnHome: false,
  },
  deepLinkOptions: {
    prompt: {
      label: 'Prompt',
      type: 'text',
    },
    autoApprove: {
      label: 'Auto-approve student notes',
      type: 'checkbox',
      defaultValue: false,
    },
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'postboard_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
    historyState: ['instructorPasscode'],
    selectedOptionsToSessionData: ['prompt', 'autoApprove'],
  },
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Your name',
        type: 'text',
        required: true,
        placeholder: 'Enter your display name',
      },
    ],
  },
  manageLayout: {
    expandShell: true,
  },
  studentLayout: {
    expandShell: true,
  },
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}
```

Notes:

- If Postboard later needs a report/export route, add `reportEndpoint` when it exists.
- If Postboard later needs custom permalink creation, prefer activity-owned UI rather than
  adding one-off shared dashboard logic.
- Keep the generic `deepLinkOptions` small for v1. `prompt` and `autoApprove` are enough for
  dashboard permalinks, `/launch/postboard`, and SyncDeck `activityOptions` to share the same
  selected-options path.
- The create-session route should accept those selected options from the shared dashboard/launcher
  flow and normalize them the same way as embedded selected options.
- The server normalizer should treat `session.data.embeddedLaunch.selectedOptions` as the source
  for embedded launch defaults only when the canonical session fields are still unset.
- The current config should stay aligned with the shared ActivityConfig shape already in use
  by Resonance and other live activities.

---

## Architecture Decisions

### Approval Flow

1. New student notes are created in a pending state when auto-approve is disabled.
2. Approved notes become visible to students and remain visible until hidden.
3. Instructor-authored posts bypass moderation and are approved immediately.
4. Approval changes must be persisted in the session state and broadcast live.
5. Rejection changes a post to `status: 'rejected'`; it does not delete the post immediately.
6. Rejected posts are omitted from peer snapshots and included only for the instructor and the
   original submitting student.
7. Resubmission should create a new pending/approved post from the edited text, leaving the
   rejected post as instructor-visible history unless a later product decision adds deletion.

### Visibility and Ordering

1. The instructor can hide and unhide notes without deleting them.
2. The instructor can reorder visible notes.
3. Reordering should affect the board presentation order, not the raw submission history.
4. Hidden notes remain available to the instructor.
5. The normalizer should repair missing/invalid `order` values deterministically from creation
   order so persisted sessions stay renderable after redeploys.

### Reactions and Flags

1. Students may react only to visible peer posts.
2. Students only see reaction counts.
3. The instructor may react to any note.
4. The instructor may flag notes for follow-up.
5. The reaction palette should be compatible with Resonance-like reaction semantics where useful.
6. Store per-user reaction choices internally and derive counts for snapshots and broadcasts.

### Privacy

1. Student-facing rendering must anonymize peer authors.
2. Instructor-facing rendering must show names.
3. Logs and diagnostics should avoid emitting raw note contents or student names unless required
   for instructor-only behavior.
4. Server route responses should use snapshot builders that explicitly omit passcodes, raw
   reaction identities, hidden peer posts, pending peer posts, rejected peer posts, and flags.
5. Student route handlers should validate the caller's participant identity before returning
   owner-only rejected posts.

### Instructor Auth

1. Generate a bounded random `instructorPasscode` when creating a session.
2. Normalize legacy/malformed sessions by generating a fresh valid passcode only when missing or
   invalid.
3. Bootstrap the passcode through `createSessionBootstrap.sessionStorage` and `historyState`,
   following MobCode's same-tab recovery pattern.
4. Require `x-instructor-passcode` or an equivalent authenticated websocket message for prompt
   edits, approval/rejection, hide/unhide, reorder, flagging, instructor-authored posts, and
   instructor reactions.
5. Never include `instructorPasscode` in generic session or student state payloads.
6. Add a persistent/embedded teacher recovery route only if implementation needs reload recovery
   beyond the shared bootstrap path; follow Video Sync/Resonance by deriving recovery from
   canonical teacher auth rather than unsigned query params.

### SyncDeck Embedding

1. Embedded Postboard sessions should be launched through the shared embedded child-session path.
2. Any bootstrap state needed by the activity should live on the child session record, not in
   SyncDeck-specific globals.
3. The activity should behave correctly when reloaded or rejoined from an embedded context.
4. The activity should not require special SyncDeck-only routes.
5. SyncDeck `activityOptions` should use the same selected-option keys as Postboard permalinks:
   `prompt` and `autoApprove`.
6. The Postboard server normalizer should read `embeddedLaunch.selectedOptions` defensively, apply
   valid defaults only before live prompt/settings exist, and preserve the embedded envelope.

---

## Implementation Plan

### Phase 1: Activity Skeleton

1. Add `activities/postboard/activity.config.ts`.
2. Add client and server entry files.
3. Add shared TypeScript types for session, post, reaction, and flag data.
4. Register the activity with the discovery system.
5. Include required waiting-room `displayName`, `deepLinkOptions.prompt`, and
   `deepLinkOptions.autoApprove` in the initial config.

### Phase 2: Server Core

1. Implement session creation with prompt text and approval mode.
2. Generate and persist `instructorPasscode` using the MobCode/Resonance-style manager auth
   pattern.
3. Implement student identity registration/lookup from accepted entry participants.
4. Implement student post submission.
5. Implement approve, reject, hide, unhide, reorder, react, and flag actions.
6. Implement server-side instructor and student snapshot builders.
7. Normalize session data on read/write, including embedded launch selected-options defaults.
8. Add structured logging for moderation actions without raw note text or student names.

### Phase 3: Instructor UI

1. Build prompt setup and session controls.
2. Build the moderation queue.
3. Build reorder controls.
4. Build hide/unhide controls.
5. Build flag and reaction controls.
6. Recover manager passcode from history state, session storage, or any later teacher-auth
   recovery endpoint before enabling instructor mutations.

### Phase 4: Student UI

1. Build prompt display and post submission form.
2. Support multiple submissions per student.
3. Render the shared board with anonymous author labels.
4. Display reaction counts.
5. Keep hidden and unapproved posts out of student view.
6. Surface owner-only rejected posts in the editor for revision/resubmission.
7. Model compact note composition/card rendering after Gallery Walk feedback UI patterns, using
   stable keys and responsive dimensions.

### Phase 5: SyncDeck Support

1. Verify embedded launch bootstrap works for Postboard.
2. Verify the embedded layout renders correctly inside SyncDeck.
3. Validate reconnect and reload behavior in embedded sessions.
4. Validate `activityOptions: { prompt, autoApprove }` through the existing
   `embeddedLaunch.selectedOptions` path.
5. Confirm embedded reload does not reapply bootstrap defaults over live instructor edits.

### Phase 6: Tests

1. Add validation tests for session normalization and post state transitions.
2. Add tests for approval, reordering, hiding, flagging, and reaction behavior.
3. Add privacy tests for instructor vs student rendering.
4. Add auth tests proving instructor-only routes reject missing/invalid passcodes.
5. Add reaction tests proving duplicate/toggle/change behavior derives counts from per-user state.
6. Add rejected-post tests proving only the submitting student and instructor can recover rejected
   text.
7. Add selected-options tests for permalink/create-session and embedded launch defaults.
8. Add embed-focused tests if the activity touches the shared embedded-launch path.
9. Add browser-level coverage if routing, waiting-room handoff, embedded rendering, or websocket
   behavior crosses shared UI surfaces.

### Phase 7: Documentation

1. Update activity docs if the final implementation adds runtime or deployment constraints.
2. Record any reusable patterns in `.agent/knowledge` if they are likely to matter for later
   activity work.
3. If SyncDeck embedded payload examples are added or changed, update
   `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`.

---

## Acceptance Criteria

1. A session can be created with one prompt and an approval mode.
2. Students can submit multiple notes.
3. Pending notes stay hidden until approved when auto-approve is off.
4. Instructor-authored notes appear immediately.
5. Students never see other students' names.
6. The instructor can reorder, hide, flag, and react to notes.
7. Students can react and see only counts.
8. Duplicate student reaction events cannot inflate counts.
9. Rejected notes are recoverable only by the submitting student and instructor.
10. Instructor-only actions require a valid instructor passcode.
11. Permalink and SyncDeck embedded launch options can seed prompt and auto-approve defaults.
12. Embedded bootstrap defaults do not overwrite live prompt edits or settings after session state
    exists.
13. The activity works in SyncDeck as an embedded child session.
14. Automated tests cover the moderation, privacy, auth, reaction, and launch-option rules.

---

## Resolved Decisions

1. Rejected posts should be removed from the board, but the submitting student should be able to
   edit what they posted and move it back into the editor for resubmission. Implementation note:
   do this with owner-only rejected-post state rather than hard-deleting the text.
2. The instructor should be able to edit the prompt after the session starts.
3. Postboard should use the same reaction palette as Resonance, with a possible future move to a
   shared reaction component if that proves useful.
4. Postboard should start with generic `deepLinkOptions` instead of a custom persistent-link
   builder. Add an activity-owned builder only if prompt/setup needs exceed simple string and
   checkbox selected options.

## Post UI Note

1. Model the editor UI after the Gallery Walk feedback UI.
2. Posts do not need to be square when posted, since a shorter rectangular card saves vertical
   height.
3. Keep the student post composition flow lightweight so the board stays compact even when
   multiple notes are visible.

---

## Implementation Checklist

- [x] Add the Postboard activity folder and config.
- [x] Define the Postboard session and post TypeScript types.
- [x] Add waiting-room display-name collection and launch selected-options for `prompt` and `autoApprove`.
- [x] Implement session creation, prompt initialization, and instructor passcode bootstrap.
- [x] Implement student note submission and approval routing.
- [x] Implement hide, unhide, reorder, flag, and reaction actions.
- [x] Implement server-side instructor/student snapshot builders.
- [x] Implement owner-only rejected-post recovery for resubmission.
- [x] Build instructor and student views with privacy-aware rendering.
- [x] Verify SyncDeck embedded launch/reconnect behavior.
  - Server coverage verifies Postboard child-session creation from SyncDeck `activityOptions`,
    embedded location/state persistence, manager bootstrap passcode, and prompt/approval-mode
    normalization. Generic SyncDeck embedded replay/reconnect tests cover stored child activity
    activation on reconnect.
- [x] Add tests for auth, moderation, privacy, reactions, launch options, and live updates.
  - Postboard route tests cover instructor auth, moderation state transitions, hide/unhide,
    reorder, binary flagging, reaction validation/toggle/change/remove behavior, student-safe
    privacy snapshots, rejected/deleted owner handling, selected options, and broadcasts.
  - Shared UI tests cover note style selection, reaction summaries, and instructor feedback
    controls used by Postboard.
- [x] Update repository notes/docs if the implementation introduces durable patterns.
  - SyncDeck payload docs now include Postboard launch payloads, and data-contract notes record
    the Postboard embedded launch normalization contract.
