# MobCode Live Student Code Mode

## Status: Implemented (2026-07-25)

## Goal

Extend live MobCode sessions so students can safely practice in their own persistent
workspace while continuing to view and run the instructor's code. The instructor retains
an editable workspace and controls when student work is writable, which instructor version
students can reset to, and whether one student's work is anonymously shared as a runnable
example.

This is a live-session feature only. It must not change standalone MobCode solo workspaces
or introduce a new student identity system.

## Product Decisions

- The feature is runner agnostic. Every workspace uses the session's selected runner and
  can be run whether it is editable or read-only.
- Student workspaces are keyed by the existing live-session participant ID and display
  name. A student returning in the same browser/session reopens the same workspace.
- Students always have access to their own work. The `Try it` control is a session-wide
  read/write flag: off locks editing, on permits a student to edit only their own workspace.
- Enabling `Try it` captures the current instructor workspace as the first starter version.
  Later instructor edits never mutate student work or the starter version automatically.
- `Broadcast` explicitly snapshots the current instructor workspace as the version that
  students can choose to reset their own work to. It never overwrites student work.
- A reset is initiated by a student, must confirm that their work will be replaced, and uses
  the current shared-changes snapshot.
- An instructor may anonymously share a selected student's workspace. The shared example is
  a third, read-only, runnable workspace for every student, including the source student.
  It remains available until the instructor explicitly unshares it or replaces it.
- Instructors see student display names in a read-only `Students` section. Students can see
  only `Instructor code`, `My code`, and an available `Shared example`; they never receive
  another student's identity or private workspace.
- MobCode embedded activity JSON gains `startTryItMode: true`. For a live embedded session, it
  starts with `Try it` enabled and publishes the initial instructor state as the first starter
  version. Missing or invalid values preserve current instructor-only behavior.

## Workspace Model

Keep `groups.default` as the instructor-owned workspace for compatibility. Add a MobCode-
specific collaboration object rather than putting student-specific behavior in shared routing
or explorer code.

```ts
interface MobCodeStudentWorkspace extends MobCodeGroupState {
  participantId: string
  displayName: string
  createdAt: number
  updatedAt: number
}

interface MobCodeStudentCodeState {
  tryItEnabled: boolean
  shareChangesEnabled: boolean
  publishedInstructorVersion: MobCodeGroupState
  starterVersion: MobCodeGroupState | null
  studentWorkspaces: Record<string, MobCodeStudentWorkspace>
  sharedExample: {
    sourceParticipantId: string
    workspace: MobCodeGroupState
    sharedAt: number
  } | null
}

session.data = {
  groups: { default: instructorWorkspace },
  studentCode: MobCodeStudentCodeState,
}
```

Normalization must retain valid existing student workspaces across reloads and redeploys,
remove malformed/oversized entries, and normalize every nested file map with the existing
MobCode file/path/UTF-8 limits. The plan must define an aggregate session-size and student-
workspace retention limit before implementation so a class cannot exceed the session store or
the expanded `/api/mobcode` body budget.

## Authorization and Data Exposure

The existing session participant context is the authority for a live student's participant ID
and name. It is browser-scoped continuity, not a login and not a credential. Do not create a
new identifier, store instructor credentials in browser storage, or reuse the solo edit token.

| Actor | Read | Write | Run |
|---|---|---|---|
| Student | Instructor, own, shared example | Own only, when `tryItEnabled` | Any visible workspace |
| Instructor | Instructor, all named student workspaces, shared example | Instructor only | Any visible workspace |

- Student API and websocket requests must receive a student-safe snapshot only: instructor
  workspace, their own workspace, `tryItEnabled`, starter-version availability, runner ID,
  and the anonymous shared example. Do not serialize other student workspaces or names.
- Every student mutation must resolve participant identity on the server, select the workspace
  from that identity rather than request input, and reject writes while `tryItEnabled` is
  false. Log expected denials with structured event names without file contents or secrets.
- Instructor-only actions (`Try it`, `Broadcast`, share/unshare example) require the
  existing MobCode instructor passcode/authenticated manager socket.
- The instructor review surface is read-only. It must not expose controls that mutate a
  selected student workspace.
- Cross-instance durable updates use the existing session persistence and broadcast path.
  Granular websocket edits must be scoped by workspace and must not relay one student's edits
  to another student's view.

## Server and Transport Plan

1. Extend `MobCodeSessionData`, session normalization, and the embedded-launch option reader
   for `startTryItMode`. Preserve old sessions by defaulting `studentCode` to disabled/no
   starter/no shared example.
2. Create explicit authenticated commands/routes for:
   - toggling `Try it`;
   - `Broadcast` (snapshot instructor code as `starterVersion`);
   - creating or returning the current student's workspace from `starterVersion`;
   - resetting the current student's workspace from `starterVersion`;
   - sharing, replacing, and unsharing an anonymous student example.
3. Split the current MobCode session read into an instructor-safe manager response and a
   participant-scoped student response, or add an equally explicit scoped endpoint. Preserve
   the existing solo response contract unchanged.
4. Add workspace identifiers to MobCode websocket messages and validate them server-side.
   Use durable state messages for snapshots, tree changes, reset, Try-it changes, and shared-
   example lifecycle; keep debounced granular content/presence updates only within the
   authorized workspace.
5. On first eligible student workspace open, atomically create the workspace from the
   current starter version. A later return reads that stored workspace; it never re-copies
   current instructor code implicitly.
6. Ensure reconnection and Valkey pub/sub replay update only the workspaces a client may see.
   Do not rely on local websocket state as the durable source of student work.

## Client Experience

### Student explorer

Render a workspace switcher above or within the existing file explorer with semantic buttons
or tabs, clear selected state, and keyboard operation:

- `Instructor code` — read-only file tree/editor, runnable.
- `My code` — own file tree/editor, runnable; editor and mutation controls are disabled with
  an explanatory message when `Try it` is off.
- `Shared example` — only when published; read-only and runnable, with no source identity.

Each workspace keeps its own active file. The editor, file controls, runner popup, and status
messages must use the selected workspace rather than assuming `groups.default`. Read-only
workspaces cannot offer create, rename, delete, upload, or edit affordances.

The student view includes an accessible `Reset my code` action when a starter version exists.
Show a confirmation modal explaining that only `My code` will be replaced and that Instructor
code and the shared example will not change.

### Instructor explorer

Render these workspace sections:

- `Instructor code` — existing full edit/import/export/run controls.
- `Students` — named, read-only student workspace entries, each runnable. Selecting a
  workspace changes the explorer/editor view without granting edit controls.
- `Shared example` — a read-only preview when present, with `Unshare` and `Replace` actions.

Add an accessible `Try it` switch that reports its checked state and clearly states that it
enables or locks student editing without deleting their work. Add `Broadcast` as a
separate explicit action, with copy stating that it updates the student reset version and does
not overwrite anyone. A student workspace's contextual instructor action creates/replaces the
anonymous shared example and must explain that the student's name will not be shown.

## Embedded Payload Contract

Document this MobCode embedded activity payload shape:

```json
{
  "files": { "main.py": "print('Hello')\\n" },
  "activeFile": "main.py",
  "runnerId": "brython-terminal",
  "startTryItMode": true
}
```

- `startTryItMode` is boolean-only; unsupported values normalize to `false`.
- It applies when SyncDeck creates a live MobCode child session. It is not a new standalone
  solo mode and does not alter the existing solo launch behavior.
- The initial `groups.default` state supplies the first student starter version. Later
  `Broadcast` snapshots are session state and take precedence for resets.
- Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` in the same implementation branch,
  as required for SyncDeck-embedded launch changes.

## Implementation Checklist

- [x] Define normalized collaboration types, aggregate limits, and participant-scoped snapshot
  builders in `activities/mobcode/shared` and `activities/mobcode/server`.
- [x] Add `startTryItMode` embedded-launch normalization and initial live-session setup while
  preserving current MobCode and standalone solo contracts.
- [x] Implement authenticated REST/websocket commands for workspace creation, student edits,
  reset, `Try it`, `Broadcast`, and anonymous share lifecycle.
- [x] Add student-safe and instructor-safe read models; ensure unauthorized cross-student
  reads/writes are impossible and structured denials are logged.
- [x] Refactor MobCode client state around a selected workspace and build accessible student
  and instructor explorer sections.
- [x] Wire runnable read-only workspaces and disabled mutation controls through the existing
  runner/file-control components without runner-specific branching.
- [x] Add confirmation and status UX for reset, sharing, replacing, unsharing, locking, and
  publishing changes.
- [x] Update `ACTIVITY_PAYLOADS.md`, MobCode capability docs, and `DEPLOYMENT.md`/`README.md`/
  `ARCHITECTURE.md` if the final session schema, operational limits, or live runtime behavior
  changes their documented contracts.
- [x] Add focused tests, run workspace checks, run root validation, and record durable
  findings in `.agent/knowledge/data-contracts.md`, `.agent/knowledge/security-notes.md`, and
  `.agent/knowledge/testing-patterns.md` as implementation evidence is established.

## Verification Plan

### Unit and server tests

- Session normalization: legacy session compatibility, `startTryItMode`, nested workspace
  sanitation, size/retention limits, initial starter snapshot, and shared-example lifecycle.
- Authorization: a student can create/read/update only their own workspace; a locked `Try it`
  rejects edits; a student cannot reset another workspace; and manager-only routes reject a
  missing/incorrect instructor credential. Intentional denial tests log `[TEST]` markers.
- Snapshot semantics: instructor edits do not alter existing workspaces or reset baseline;
  `Broadcast` replaces only the baseline; reset replaces only the requesting student's
  workspace; sharing never changes source or peer workspaces.
- Response shaping: student responses contain no other student names/workspaces and manager
  responses contain named read-only student metadata without credentials.
- Transport: workspace-scoped websocket relays, durable broadcast/reconnect behavior, and
  no cross-workspace presence/content leakage.

### Client and browser tests

- Component tests for selected workspace state, per-workspace active files, disabled editing,
  available run actions, labels/roles/ARIA state, reset confirmation, and anonymous source
  labeling.
- Playwright live-session coverage using two student browser contexts and one instructor:
  enable/disable `Try it`; create and resume own work; run instructor/own/shared code; publish
  changes then reset one student; inspect named work as instructor; share, replace, and
  unshare an anonymous example; verify student A never sees student B's identity or files.
- Embedded-launch coverage for `startTryItMode: true` confirming initial student editing is on
  and the initial starter snapshot is available.

Run targeted MobCode tests plus activity lint/typecheck first. Because this work crosses
routing, HTTP, websocket, browser storage, and embedded activity launch boundaries, finish
with `npm test` and `npm run test:e2e` (or the documented sandbox fallback/exception).

## Non-Goals

- No cross-device identity or account/recovery system.
- No modification of standalone MobCode solo workspaces.
- No student-to-student editing, direct peer workspace browsing, merge/conflict resolution,
  or instructor editing of student code.
- No automatic propagation of instructor edits into existing student workspaces.
- No runner-specific branching in collaboration behavior.
