# Postboard Plan

## Status: Design / Pre-Implementation

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

---

## Confirmed Decisions

1. One prompt per session for v1.
2. Instructor-authored posts are always approved immediately.
3. Reaction visibility is counts only.
4. SyncDeck embedding is required and must use the normal embedded child-session contract.
5. The data model should leave room for future multiple prompt/response sets without forcing them
   into the current UI.

---

## Goals

- Let an instructor create and control a single prompt per session.
- Let students submit multiple notes in response to that prompt.
- Require instructor approval before student notes appear to the class, unless auto-approve is on.
- Keep student identities visible only to the instructor.
- Allow the instructor to reorder, hide, unhide, flag, and react to notes.
- Allow students to react to visible peer notes using count-based reactions.
- Support SyncDeck embedded launch and reconnect behavior.

## Non-Goals

- Multiple active prompts in v1.
- Student-visible reactor identities.
- Threaded replies or comment trees.
- Editing existing student notes after submission.
- Separate instructor and student reaction systems.

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

### Out of Scope

- Multiple prompt sets in the first release.
- Per-user reaction identity display.
- Direct student-to-student messaging.
- Nested responses or threads.
- New shared embedded-session abstractions beyond the current contract.

---

## Data Model Direction

Postboard should use session data that can evolve without breaking existing sessions.

### Session Data Sketch

```ts
interface PostboardSessionData {
  mode: 'postboard'
  prompt: {
    id: string
    text: string
    createdAt: number
  }
  settings: {
    autoApprove: boolean
  }
  posts: PostboardPost[]
  reactions: Record<string, Record<string, number>>
  flags: Record<string, PostboardFlag[]>
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
  approvedAt: number | null
  hiddenAt: number | null
  order: number
  visible: boolean
}
```

### Reactions

Reactions should be stored as counts keyed by post and reaction type.

```ts
interface PostboardReactionState {
  [postId: string]: {
    [reactionId: string]: number
  }
}
```

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

### Expansion Note

The current release should remain single-prompt, but the schema should avoid locking the UI
into a shape that would block a later `prompts[]` or `responseSets[]` expansion.

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
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'postboard_instructor_',
        responseField: 'instructorPasscode',
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
- The current config should stay aligned with the shared ActivityConfig shape already in use
  by Resonance and other live activities.

---

## Architecture Decisions

### Approval Flow

1. New student notes are created in a pending state when auto-approve is disabled.
2. Approved notes become visible to students and remain visible until hidden.
3. Instructor-authored posts bypass moderation and are approved immediately.
4. Approval changes must be persisted in the session state and broadcast live.

### Visibility and Ordering

1. The instructor can hide and unhide notes without deleting them.
2. The instructor can reorder visible notes.
3. Reordering should affect the board presentation order, not the raw submission history.
4. Hidden notes remain available to the instructor.

### Reactions and Flags

1. Students may react only to visible peer posts.
2. Students only see reaction counts.
3. The instructor may react to any note.
4. The instructor may flag notes for follow-up.
5. The reaction palette should be compatible with Resonance-like reaction semantics where useful.

### Privacy

1. Student-facing rendering must anonymize peer authors.
2. Instructor-facing rendering must show names.
3. Logs and diagnostics should avoid emitting raw note contents or student names unless required
   for instructor-only behavior.

### SyncDeck Embedding

1. Embedded Postboard sessions should be launched through the shared embedded child-session path.
2. Any bootstrap state needed by the activity should live on the child session record, not in
   SyncDeck-specific globals.
3. The activity should behave correctly when reloaded or rejoined from an embedded context.
4. The activity should not require special SyncDeck-only routes.

---

## Implementation Plan

### Phase 1: Activity Skeleton

1. Add `activities/postboard/activity.config.ts`.
2. Add client and server entry files.
3. Add shared TypeScript types for session, post, reaction, and flag data.
4. Register the activity with the discovery system.

### Phase 2: Server Core

1. Implement session creation with prompt text and approval mode.
2. Implement student post submission.
3. Implement approve, reject, hide, unhide, reorder, react, and flag actions.
4. Normalize session data on read/write.
5. Add structured logging for moderation actions.

### Phase 3: Instructor UI

1. Build prompt setup and session controls.
2. Build the moderation queue.
3. Build reorder controls.
4. Build hide/unhide controls.
5. Build flag and reaction controls.

### Phase 4: Student UI

1. Build prompt display and post submission form.
2. Support multiple submissions per student.
3. Render the shared board with anonymous author labels.
4. Display reaction counts.
5. Keep hidden and unapproved posts out of student view.

### Phase 5: SyncDeck Support

1. Verify embedded launch bootstrap works for Postboard.
2. Verify the embedded layout renders correctly inside SyncDeck.
3. Validate reconnect and reload behavior in embedded sessions.

### Phase 6: Tests

1. Add validation tests for session normalization and post state transitions.
2. Add tests for approval, reordering, hiding, flagging, and reaction behavior.
3. Add privacy tests for instructor vs student rendering.
4. Add embed-focused tests if the activity touches the shared embedded-launch path.

### Phase 7: Documentation

1. Update activity docs if the final implementation adds runtime or deployment constraints.
2. Record any reusable patterns in `.agent/knowledge` if they are likely to matter for later
   activity work.

---

## Acceptance Criteria

1. A session can be created with one prompt and an approval mode.
2. Students can submit multiple notes.
3. Pending notes stay hidden until approved when auto-approve is off.
4. Instructor-authored notes appear immediately.
5. Students never see other students' names.
6. The instructor can reorder, hide, flag, and react to notes.
7. Students can react and see only counts.
8. The activity works in SyncDeck as an embedded child session.
9. Automated tests cover the moderation and privacy rules.

---

## Resolved Decisions

1. Rejected posts should be removed from the board, but the submitting student should be able to
   edit what they posted and move it back into the editor for resubmission.
2. The instructor should be able to edit the prompt after the session starts.
3. Postboard should use the same reaction palette as Resonance, with a possible future move to a
   shared reaction component if that proves useful.

## Post UI Note

1. Model the editor UI after the Gallery Walk feedback UI.
2. Posts do not need to be square when posted, since a shorter rectangular card saves vertical
   height.
3. Keep the student post composition flow lightweight so the board stays compact even when
   multiple notes are visible.

---

## Implementation Checklist

- [ ] Add the Postboard activity folder and config.
- [ ] Define the Postboard session and post TypeScript types.
- [ ] Implement session creation and prompt initialization.
- [ ] Implement student note submission and approval routing.
- [ ] Implement hide, unhide, reorder, flag, and reaction actions.
- [ ] Build instructor and student views with privacy-aware rendering.
- [ ] Verify SyncDeck embedded launch/reconnect behavior.
- [ ] Add tests for moderation, privacy, and live updates.
- [ ] Update repository notes/docs if the implementation introduces durable patterns.
