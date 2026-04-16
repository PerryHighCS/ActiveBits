# Mob Code Activity - Implementation Plan

## Context

ActiveBits is a classroom activity platform where teachers run interactive sessions with students via real-time WebSocket sync. The user wants a new **"Mob Code"** activity: a collaborative code editor where the instructor writes code (with multi-file support) and students watch in real-time. Files can be uploaded/downloaded as zips to persist work across class sessions. This is Phase 1 of a multi-phase feature (Phase 2: code runners like Brython/CheerpJ; Phase 3: students can edit; Phase 4: breakout groups with independent file copies).

**TypeScript Baseline**: This plan assumes the TypeScript migration is complete. New activity files use `.ts`/`.tsx`.

## Editor Choice: CodeMirror 6

Using `@uiw/react-codemirror` (React wrapper for CodeMirror 6):
- **~100KB gzipped** vs Monaco's ~2MB - critical since students on phones/chromebooks
- Modular language packs loaded on demand per file extension
- First-class `readOnly` support for the student view
- **Multiple built-in themes** + easy custom theme support for the settings menu
- Clean extension system for Phase 2 (output panel) and Phase 3 (collaborative editing)
- Excellent mobile rendering

## Data Model

Session state designed with future group support (Phase 4) in mind:

```ts
// Phase 1: single group (implicit "default" group)
session.data = {
  groups: {
    "default": {                        // Phase 4 will add named groups
      files: {                          // flat path → content map
        "Main.java": "public class Main { ... }",
        "utils/Helper.java": "...",
      },
      activeFile: "Main.java",         // currently open file path
    }
  }
}
```

Using a `groups` map from the start means Phase 4 (breakout groups) only needs to add group management UI and copy the "default" group's files into new named groups - no data model migration. Phase 1 always reads/writes `groups["default"]`.

Flat path map within each group is simpler than nested trees for serialization and diffing. The file tree UI derives folder hierarchy from paths at render time.

### Phase 3 Data Model Extension (Planned)

Additive state to support student-driven collaboration modes without replacing the Phase 1 baseline:

```ts
session.data = {
  groups: {
    default: {
      files: { /* instructor/shared files */ },
      activeFile: 'Main.java',
    },
  },
  collaboration: {
    mode: 'instructor' | 'driver' | 'personal-copies',
    // global default policy selected from toolbar
    globalPolicy: {
      allowDriveShared: boolean,
      allowEditPersonalCopy: boolean,
    },
    // driver mode: selected student edits the shared files and everyone follows
    driverStudentId: string | null,
    // personal-copies mode: selected student's personal copy is broadcast to viewers
    broadcastStudentId: string | null,
    // preserve selected student work when switching back to instructor mode
    takeoverPolicy: 'preserve' | 'discard',
    takeoverSourceStudentId: string | null,
    studentPermissions: {
      [studentId: string]: {
        canDriveSharedOverride: boolean | null,
        canEditPersonalCopyOverride: boolean | null,
      },
    },
    personalCopies: {
      [studentId: string]: {
        files: Record<string, string>,
        activeFile: string,
        updatedAt: number,
      },
    },
  },
}
```

Notes:

- `instructor`: existing Phase 1 behavior.
- `driver`: one authorized student can edit shared files; all viewers follow those edits.
- `personal-copies`: authorized students edit personal copies; instructor can select one student's copy to broadcast for everyone to view.
- Global policy comes from toolbar mode; per-student overrides in roster can tighten or relax permissions for individuals.
- Recommended default when instructor retakes control: `takeoverPolicy = 'preserve'` (student edits stay in personal copy snapshots, shared files revert to instructor-owned state unless instructor explicitly applies a student copy).

## Theme Settings

- **Settings button** (sprocket icon) in the toolbar opens a dropdown/popover with a theme chooser
- Available themes: Light (default, CodeMirror built-in), One Dark (`@codemirror/theme-one-dark`), GitHub Light, GitHub Dark (both from `@uiw/codemirror-theme-github`)
- Selected theme stored in a **cookie** (`mobcode-theme`) so it persists across sessions within the same browser profile
- Both manager and student views respect the theme preference independently (each user picks their own)
- `SettingsMenu.tsx` component handles the sprocket icon + dropdown

## File Structure

```
activities/mobcode/
├── activity.config.ts
├── client/
│   ├── index.tsx
│   ├── manager/
│   │   └── MobCodeManager.tsx
│   ├── student/
│   │   └── MobCodeStudent.tsx
│   ├── components/
│   │   ├── CodeEditor.tsx          # CodeMirror wrapper with theme support
│   │   ├── FileTree.tsx            # Sidebar file browser
│   │   ├── FileTreeItem.tsx        # Single tree node
│   │   ├── EditorToolbar.tsx       # Zip upload/download, new file/folder, settings
│   │   ├── SettingsMenu.tsx        # Theme chooser dropdown
│   │   └── FileNameModal.tsx       # Create/rename file dialog
│   └── utils/
│       ├── constants.ts            # Message types, theme list
│       ├── languageMap.ts          # Extension → CodeMirror language
│       ├── fileUtils.ts            # Tree building, path validation
│       └── themeUtils.ts           # Cookie read/write for theme preference
└── server/
    └── routes.ts
```

Note: This plan targets the post-migration TypeScript layout used across activities.

## Sync Transport

Two broadcast paths, chosen by update type:

**1. WS-relayed (low-latency, local-instance only)**
The manager sends a WS message to the server. The mobcode WS registration adds a `socket.on('message')` handler inside its `ws.register` callback. This handler parses the message, validates the type, and relays it to all other clients with the same `sessionId` on the local instance. Used for:
- `file-content-update` — instructor typing (debounced 500ms)
- `active-file-changed` — tab switch (immediate)

**2. HTTP-triggered (durable, cross-instance)**
The manager POSTs to `/api/mobcode/:sessionId/state`. The server persists to the session store and calls the `broadcast()` helper, which sends to local WS clients AND publishes via Valkey pub/sub for multi-instance deployments. Used for:
- `state-sync` — zip upload and durable full-state persistence events
- `file-tree-changed` — create/rename/delete (infrequent, needs persistence)

**Why two paths**: Typing at 500ms intervals would generate excessive HTTP requests. WS relay is fire-and-forget with no persistence overhead. But WS relay is local-instance only (no Valkey pub/sub), so durable state changes must go through HTTP. If a student reconnects or joins late, they fetch full state from the server via GET.

## Multi-Instance Sync Guarantees

- **Same-instance clients**: receive low-latency typing updates via WS relay (`file-content-update`, `active-file-changed`).
- **Cross-instance clients**: converge through durable HTTP persistence + `broadcast()` pub/sub fanout.
- **Expected staleness window across instances**: up to the content persistence debounce window (currently 5 seconds) unless a file switch/tree change/zip upload triggers immediate persist.
- **Product behavior note**: "real-time" typing is guaranteed within the same instance; cross-instance behavior is near-real-time convergence bounded by persistence triggers.
- **Future optimization path**: if strict cross-instance low-latency typing is required, add server-side relay of granular edits through Valkey pub/sub (or equivalent shared transport) with rate limits.

## WebSocket Message Types

| Message Type | Transport | Trigger | Payload |
|---|---|---|---|
| `state-sync` | HTTP-broadcast | Zip upload, durable persist events | `{ files, activeFile }` |
| `file-content-update` | WS-relay | Instructor typing (500ms debounce) | `{ path, content }` |
| `active-file-changed` | WS-relay | Tab switch | `{ activeFile }` |
| `file-tree-changed` | HTTP-broadcast | Create/rename/delete file | `{ files, activeFile }` |

## Persistence Policy

Single policy: the manager persists full state via `POST /api/mobcode/:sessionId/state` on:
1. **File switch** — immediate (user intent boundary, also broadcasts `state-sync`)
2. **Content edit** — debounced **5 seconds** after last keystroke (batches rapid edits)
3. **Zip upload** — immediate
4. **File tree change** — immediate (create/rename/delete)

No separate periodic interval. The 5s content debounce plus file-switch triggers provide sufficient durability without redundancy.

## Zip Handling (Client-Side with JSZip)

Upload and download both happen in the browser using `jszip` — no server-side file handling needed:
- **Upload**: `<input type="file" accept=".zip">` → `JSZip.loadAsync()` → extract to `{ path: content }` map → broadcast `state-sync`
- **Download**: Build `JSZip` from files map → `generateAsync({ type: 'blob' })` → trigger download

### Zip Safety Constraints

| Constraint | Limit | Behavior |
|---|---|---|
| Max zip file size | 10 MB | Reject before extraction with user-facing error |
| Max extracted file count | 200 files | Stop extraction, warn user |
| Max per-file size | 1 MB | Skip file, log warning in console |
| Max total extracted size | 25 MB | Stop extraction and reject archive to avoid zip-bomb expansion |
| Path traversal (`../`) | Reject | Normalize paths, strip leading `../` and `/`, reject any remaining `..` segments |
| OS artifacts | Skip | Filter `__MACOSX/`, `.DS_Store`, `Thumbs.db`, `.git/` |
| Binary/non-UTF-8 files | Skip | Attempt UTF-8 decode; if it fails or file extension is known-binary (`.class`, `.jar`, `.png`, `.jpg`, etc.), skip with a note in the file tree or a toast |
| Empty zip | Allow | Results in empty file tree, no error |

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/mobcode/create` | Create session with empty default group |
| `GET` | `/api/mobcode/:sessionId/session` | Get full session state |
| `POST` | `/api/mobcode/:sessionId/state` | Full state update (persist + broadcast `state-sync`) |

See "Sync Transport" section above for how each message type is routed. The `/state` endpoint handles durable persistence and cross-instance broadcast via Valkey pub/sub. Granular typing updates use WS-relay for low latency.

## Security and Authorization

- **Manager-only mutations**: all state mutation routes and WS mutation messages must require manager/instructor authorization for the session.
- **Student role restrictions**: student clients may only subscribe/read; any incoming student mutation attempt should be rejected and logged.
- **Endpoint protections**:
  - `POST /api/mobcode/create`: require teacher/manager context.
  - `POST /api/mobcode/:sessionId/state`: require manager authorization scoped to `:sessionId`.
  - `GET /api/mobcode/:sessionId/session`: allow authorized participants for that session; deny unrelated sessions.
- **WS protections**:
  - Validate socket role and session membership before accepting `file-content-update` and `active-file-changed`.
  - Drop and log unauthorized or malformed messages using structured logging.
- **Validation and limits**:
  - Enforce max payload size on WS and HTTP state updates.
  - Validate file path/content schema server-side even if already validated client-side.

## Dependencies to Install

```
npm install --workspace activities \
  @uiw/react-codemirror \
  @uiw/codemirror-theme-github \
  @codemirror/theme-one-dark \
  @codemirror/lang-javascript \
  @codemirror/lang-java \
  @codemirror/lang-python \
  @codemirror/lang-html \
  @codemirror/lang-css \
  @codemirror/lang-json \
  @codemirror/lang-markdown \
  @codemirror/lang-xml \
  @codemirror/lang-sql \
  @codemirror/lang-cpp \
  jszip
```

Theme packages:
- `@uiw/react-codemirror` includes CodeMirror's default light theme
- `@codemirror/theme-one-dark` for One Dark
- `@uiw/codemirror-theme-github` exports `githubLight` and `githubDark`

All isolated to the `activity-mobcode-*.js` chunk via Vite's existing `manualChunks` config.

## Implementation Steps

### Step 1: Scaffold + Config
- Create directory structure under `activities/mobcode/`
- Write `activity.config.ts` (`id: 'mobcode'`, `color: 'sky'`, `soloMode: false`)
- Write stub `client/index.tsx` and `server/routes.ts`
- Add `"mobcode"` to `EXPECTED_ACTIVITIES` in both test files:
  - [index.test.ts](client/src/activities/index.test.ts)
  - [activityRegistry.test.ts](server/activities/activityRegistry.test.ts)
- Verify: `npm test` passes

### Step 2: Install Dependencies
- Run npm install command above
- Verify: `npm run build` succeeds (client workspace)

### Step 3: Utilities
- `constants.ts` - message type constants, theme name list
- `languageMap.ts` - file extension → dynamic `import()` of CodeMirror language pack
- `fileUtils.ts` - `buildTree()` (flat map → nested tree), `isValidFileName()`, `getFileExtension()`
- `themeUtils.ts` - `getThemeFromCookie()`, `setThemeCookie()` using `document.cookie`

### Step 4: CodeEditor Component
- Wrap `@uiw/react-codemirror` with props: `value`, `onChange`, `readOnly`, `filename`, `theme`
- Dynamic language loading based on file extension via `languageMap.ts`
- Theme prop selects from available CodeMirror themes
- Extensions: line numbers, bracket matching, fold gutter, active line highlight
- Read-only mode via `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`

### Step 5: FileTree Component
- `FileTreeItem.tsx` - renders file/folder node with indent, expand/collapse, active highlight
- `FileTree.tsx` - takes flat `files` map, calls `buildTree()`, renders recursively
- Click to select file; right-click or icon buttons for rename/delete (gated by `readOnly` prop)
- Folders sorted before files, alphabetical within groups

### Step 6: EditorToolbar + SettingsMenu + FileNameModal
- `EditorToolbar.tsx` - zip upload button, zip download button, new file button, new folder button, settings sprocket
- `SettingsMenu.tsx` - sprocket icon opens dropdown with theme selector; reads/writes theme cookie
- `FileNameModal.tsx` - shared modal for create and rename (uses `Modal` from [ui/Modal](client/src/components/ui/Modal.tsx))
- Zip upload: reads file → `JSZip.loadAsync()` → extracts text files → calls `onUpload(files)`
- Zip download: builds zip from files map → triggers browser download

### Step 7: Server Routes
- Session normalizer ensuring `groups.default.files` is an object and `groups.default.activeFile` is a string
- WebSocket registration at `/ws/mobcode` with `socket.on('message')` handler that:
  - Parses incoming JSON, validates `msg.type` is `file-content-update` or `active-file-changed`
  - Relays to all other `wss.clients` with same `sessionId` (local-instance only)
  - Ignores/drops any unrecognized message types
- `POST /api/mobcode/create` - creates session with `{ groups: { default: { files: {}, activeFile: '' } } }`
- `GET /api/mobcode/:sessionId/session` - returns session
- `POST /api/mobcode/:sessionId/state` - updates default group state, persists, broadcasts via `broadcast()` helper (includes Valkey pub/sub for cross-instance)
- Broadcast helper following [algorithm-demo routes.ts](activities/algorithm-demo/server/routes.ts) pattern

### Step 8: MobCodeManager (Instructor View)
- Layout: `SessionHeader` + toolbar (with settings sprocket) + sidebar (`FileTree` ~250px) + main (`CodeEditor`)
- State: `files`, `activeFile` in React state (read from `session.data.groups.default`)
- Theme state: loaded from cookie on mount, passed to `CodeEditor`
- WebSocket via `useResilientWebSocket` following [DemoManager.tsx](activities/algorithm-demo/client/manager/DemoManager.tsx) pattern
- On content edit: WS-relay `file-content-update` (500ms debounce) + HTTP persist (5s debounce)
- On file switch: WS-relay `active-file-changed` (immediate) + HTTP persist (immediate)
- On tree change / zip upload: HTTP-broadcast `file-tree-changed` / `state-sync` (immediate persist + broadcast)
- File tree operations: create/rename/delete update local state then POST to server

### Step 9: MobCodeStudent (Student View)
- Same layout but `CodeEditor` in read-only mode, `FileTree` click-to-view only
- Own theme preference from cookie (independent of instructor's choice)
- Settings sprocket available for theme selection
- WebSocket with `useSessionEndedHandler` following [DemoStudent.tsx](activities/algorithm-demo/client/student/DemoStudent.tsx) pattern
- Handles all message types to update local state
- Shows "Waiting for instructor to load code..." when files map is empty
- Fetches initial state from server on mount

### Step 10: Automated Tests
Add unit tests in `activities/mobcode/client/utils/` and `activities/mobcode/server/`:
- **fileUtils.test.ts**: `buildTree()` with nested paths, empty map, single file; `isValidFileName()` rejects `../`, `/`, empty, null bytes, too-long names; path normalization strips leading `../` and `/`
- **themeUtils.test.ts**: `getThemeFromCookie()` returns default when no cookie; `setThemeCookie()` writes expected cookie string; round-trip read/write
- **session normalizer test** (in `server/routes.test.ts`): normalizer creates `groups.default` when missing; normalizer preserves valid data; normalizer resets invalid `files` to `{}`
- **zip safety tests** (in a `zipUtils.test.ts` or inline in component test): rejects zip > 10MB; enforces max total extracted size (25MB); skips `__MACOSX/` and `.DS_Store`; rejects paths with `../` traversal; skips binary files; respects max file count (200) and max per-file size (1MB)
- **authorization tests** (server route + WS handler): manager can mutate; student mutation attempts are rejected; unauthorized session access returns denied response

Run `npm test` to verify all pass.

## Accessibility Acceptance Criteria

- Toolbar controls use native `<button>` elements with accessible names.
- Settings/menu toggles expose `aria-expanded` and `aria-controls` when applicable.
- File tree supports keyboard navigation (arrow keys to move, Enter/Space to activate).
- Active file is communicated via visual state plus semantic state (`aria-current` or equivalent tree semantics).
- Icon-only controls include `aria-label`.
- Modal flows (create/rename) provide focus trap, Escape close, and restore focus to the invoking control.
- Student read-only editor still exposes readable cursor/selection contrast and text scaling for mobile users.

### Step 11: Manual Integration Testing
- Create session → upload zip → verify student sees files live
- Edit file → student sees changes in real-time
- Switch files → student follows
- Create/rename/delete files → student tree updates
- Download zip → verify contents match
- Theme change persists across page reload (cookie)
- End session → student redirected

## Layout

```
+--------------------------------------------------+
| SessionHeader (join code, end session)            |
+--------------------------------------------------+
| Toolbar (upload, download, new file/dir, [gear])  |
+-----------+--------------------------------------+
| FileTree  |  CodeEditor                          |
| (sidebar) |  (main area, themed)                 |
|  ~250px   |                                      |
|           +--------------------------------------+
|           |  [Phase 2: Console/Output Panel]     |
+-----------+--------------------------------------+
```

The right column can be split vertically in Phase 2 to add a runner output panel.

## Future Phase Considerations

| Phase | Feature | Data Model Impact |
|---|---|---|
| Phase 2 | Code runners (Brython, CheerpJ) | Add `output` field per group; split editor layout for console panel |
| Phase 3 | Student editing + roster controls | Add collaboration modes, per-student permissions, personal copy state, and broadcast source selection |
| Phase 4 | Breakout groups | Instructor creates named groups, copies `default` files into each; students assigned to groups; each group has independent files/activeFile |

The `groups` map in the data model supports all phases without migration.

## Phase 2 Runner Modernization Plan

The existing CheerpJ console implementation from `mrbdahlem/learn` should be treated as a **reference implementation**, not copied directly into MobCode.

Legacy reference characteristics:

- separate popup window for terminal/graphics display
- `xterm` terminal surface with manual stdin/stdout bridging
- global CheerpJ loader usage
- large hard-coded preload resource lists
- custom Java runner classes and compile-unit orchestration

### Phase 2 Goals

- Embed the runner inside the MobCode layout instead of opening a popup.
- Upgrade to a current CheerpJ version/API supported by the modern loader/runtime.
- Preserve the useful terminal/graphics concepts from the old console page.
- Avoid hard-coded preload lists unless they are still strictly required by the current CheerpJ runtime.
- Define a runner abstraction that allows CheerpJ and Brython to plug into the same MobCode host contract.
- Keep the host shell runtime-agnostic: same toolbar actions, same terminal/output panel, same lifecycle, different adapters underneath.

### Recommended Architecture

- Add a shared runner panel in the lower editor region planned for Phase 2.
- Separate the system into:
  - `RunnerHost`: MobCode-owned UI shell, lifecycle management, toolbar integration, terminal/output tabs, run status, stop/restart actions.
  - `RunnerAdapter`: runtime-specific implementation for CheerpJ, Brython, or future engines.
  - `RunnerCompileUnit`: normalized input model derived from the MobCode file map.
  - `RunnerEventStream`: normalized output/events emitted back to the host.
- Define a generic runner interface such as:

```ts
interface RunnerFile {
  path: string
  content: string
}

interface RunnerCompileUnit {
  runtime: 'java-cheerpj' | 'python-brython'
  files: RunnerFile[]
  entryFile?: string
  entrySymbol?: string
  args?: string[]
  stdinEnabled?: boolean
  graphicsEnabled?: boolean
}

type RunnerEvent =
  | { type: 'status'; value: 'idle' | 'initializing' | 'compiling' | 'running' | 'stopped' | 'error' }
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'diagnostic'; level: 'info' | 'warning' | 'error'; message: string; path?: string; line?: number; column?: number }
  | { type: 'graphics-ready' }
  | { type: 'exit'; code: number }

interface MobCodeRunnerAdapter {
  initialize(): Promise<void>
  getCapabilities(): {
    supportsCompileStep: boolean
    supportsInteractiveStdin: boolean
    supportsGraphics: boolean
    supportsMultiFile: boolean
  }
  compileAndRun(input: RunnerCompileUnit): Promise<void>
  sendInput(data: string): void
  stop(): Promise<void>
  dispose(): Promise<void>
  onEvent(listener: (event: RunnerEvent) => void): () => void
}
```

- Implement `CheerpJRunnerAdapter` and `BrythonRunnerAdapter` against that same interface.
- Keep terminal rendering (`xterm`) and runner lifecycle separate so runtime-specific code does not leak into the editor shell.

### Abstraction Rules

- The host must not know CheerpJ-specific or Brython-specific API details.
- Runtime adapters receive the same normalized file map and return the same normalized event stream.
- Runtime-specific filesystem setup, preload behavior, and entrypoint logic stay inside the adapter.
- The host decides what UI to show from adapter capabilities rather than hard-coding runtime names.

Examples:

- CheerpJ may use `supportsCompileStep = true`, `supportsGraphics = true`, `supportsMultiFile = true`.
- Brython may use `supportsCompileStep = false`, `supportsGraphics = false`, `supportsMultiFile = limited/true` depending on implementation strategy.

### Why This Matters

- MobCode gets one runner panel UX instead of one-off Java and Python flows.
- Brython and CheerpJ can share the same run/stop/input/output wiring.
- New runtimes can be added later without rewriting the host shell.
- Testing becomes simpler because the host can be exercised against a fake adapter.

### CheerpJ Migration Strategy

1. **Inventory current legacy behavior**
- map the current `javaConsole.html` flow: init, preload, file injection, compile task, run task, stdin/stdout bridging, optional graphics display.
- identify which custom Java runner classes are still needed and whether they run unchanged on the newer runtime.

2. **Upgrade runtime first**
- validate the current CheerpJ loader/API and update integration calls accordingly.
- verify whether `cheerpjInit`, filesystem injection, display creation, and main-class execution APIs changed.

3. **Replace popup with embedded panel**
- move terminal/graphics tabs into the MobCode runner panel.
- keep graphics display optional and only show it when the selected runtime/program requires it.

4. **Reduce preload brittleness**
- avoid carrying forward large static preload arrays unless required.
- if preload tuning is still needed, isolate preload configuration in one runtime-specific module with comments explaining why each list exists.

5. **Validate custom runner jars**
- test whether the existing `CheerpJRunner.jar` and compile task pipeline still work on the updated runtime.
- if they do not, replace them with a simpler compile/run orchestration aligned to the newer API.

### Phase 2 UX Expectations

- Instructor runs code from the toolbar or runner panel.
- Output appears inline in the split runner panel, not a new browser window.
- Terminal input is interactive when the program requests stdin.
- If graphics mode is supported, terminal and graphics can be switched via tabs in the panel.
- Student visibility policy should be configurable later, but initial Phase 2 assumption can remain instructor-centric execution.

### Phase 2 Risks

- newer CheerpJ versions may require API changes beyond a script URL swap.
- old preload/resource assumptions may be obsolete or incompatible.
- custom runner jars may depend on legacy classpath or runtime behavior.
- embedding graphics in-panel may behave differently than popup-window hosting.

### Phase 2 Validation Checklist

- compile and run a simple single-file Java program in the embedded panel.
- compile and run a multi-file Java program from the MobCode file map.
- verify stdin round-trip from `xterm` to running program.
- verify stdout/stderr separation or equivalent visible handling.
- verify graphics program behavior if GUI support is retained.
- verify runner teardown/restart between executions without stale state leakage.

## Phase 3 Collaboration Control Plan

Use the shared student roster control (from the common student presence component plan) as the management surface for per-student collaboration actions.

### Shared Roster Control Integration

- Host control surface: common student roster panel with per-student custom action container.
- Global controls exposed in toolbar:
  - `Mode: Instructor Only` (default)
  - `Mode: One Student Drives Shared Editor`
  - `Mode: Students Edit Personal Copies`
  - `Allow Everyone Personal Edit` toggle
  - `Reset Overrides` action
- Per-student controls exposed from the parent manager:
  - `Allow Shared Driver`: enables a student to become the shared editor.
  - `Set as Active Driver`: makes that student the current shared editor and switches mode to `driver`.
  - `Allow Personal Editing (Override)`: allows or blocks personal editing for a specific student regardless of global toggle.
  - `Display This Student's Code`: sets `broadcastStudentId` so all viewers see that student's copy.
- Per-student badges and row styling indicate status:
  - badges: `Driver`, `Personal Edit Enabled`, `Override`, `Broadcast Source`
  - style hooks: warning/attention states for disconnected or out-of-date copies

### Instructor Takeover Behavior

When instructor switches mode back to `instructor`:

- Shared editor authority immediately returns to instructor.
- Student typing is blocked in real-time until permissions are re-enabled.
- Student personal copies are preserved by default (`takeoverPolicy = 'preserve'`).
- If a student was the broadcast source, `broadcastStudentId` is cleared.
- Instructor gets an explicit action to apply a preserved student copy into shared files:
  - `Apply Student Copy to Shared`
  - `Discard Student Copy`

Rationale:

- Preserving avoids accidental student work loss.
- Explicit apply/discard avoids silent overwrite of instructor/shared state.
- Clearing broadcast source prevents stale "following student" view after takeover.

### Divergence and Sync Policy (No Merge)

- This phase intentionally avoids Git-style or line-based merge complexity.
- Student personal copies and shared instructor files are treated as separate branches of state.
- When shared code changes after student copies diverge, personal copies are **not** auto-merged.
- Allowed reconciliation actions are explicit and simple:
  - `Replace Student Copy from Shared` (student copy becomes latest shared snapshot)
  - `Apply Student Copy to Shared` (shared files are replaced by selected student copy)
  - `Keep Diverged Copy` (no change)
  - `Discard Student Copy` (delete student personal copy state)
- Permission model:
  - `Apply Student Copy to Shared` is **instructor only**.
  - `Replace`, `Keep`, and `Discard` can be exposed as student self-actions.
  - Instructor can also apply `Replace`/`Discard` as per-student actions and as global actions for all students.
- Scope model for `Replace`/`Keep`/`Discard`:
  - support both `all-files` and `single-file` scope.
  - single-file scope targets one file path in the student's copy.
- Student view toggle model:
  - students always have a visible toggle to switch between `Instructor Copy` and `My Copy` views.
  - if the student has no personal copy (never edited, replaced, or discarded), `My Copy` resolves to instructor copy content.
  - toggling view does not itself mutate stored files; it changes the source-of-truth view in the editor UI.
  - in `Instructor Copy` view, student editing is disabled unless collaboration mode/permissions explicitly allow shared driving.
  - in `My Copy` view, editing follows personal-copy permission rules.
- UI should mark diverged copies with a badge and never perform silent merge or conflict resolution.

### Collaboration Message Types (Phase 3)

- `collaboration-mode-changed`: `{ mode, driverStudentId, broadcastStudentId }`
- `collaboration-global-policy-changed`: `{ allowDriveShared, allowEditPersonalCopy }`
- `student-permission-changed`: `{ studentId, canDriveSharedOverride, canEditPersonalCopyOverride }`
- `student-personal-update`: `{ studentId, path, content, activeFile }`
- `broadcast-student-selected`: `{ broadcastStudentId }`
- `instructor-took-over`: `{ takeoverPolicy, takeoverSourceStudentId }`
- `apply-student-copy-to-shared`: `{ studentId }`
- `replace-student-copy-from-shared`: `{ actorRole, studentId, scope: 'all-files' | 'single-file', path?: string }`
- `keep-diverged-copy`: `{ actorRole, studentId, scope: 'all-files' | 'single-file', path?: string }`
- `discard-student-copy`: `{ actorRole, studentId, scope: 'all-files' | 'single-file', path?: string }`
- `student-view-source-changed`: `{ studentId, viewSource: 'instructor' | 'personal' }`

Transport policy remains aligned with Phase 1 principles:

- granular edits: low-latency relay path
- mode/permission/source changes: durable persisted path with cross-instance broadcast

### Phase 3 Acceptance Criteria

- Instructor can select global collaboration mode and global edit policy from the toolbar.
- Instructor can manage per-student overrides from the shared roster control.
- Instructor can select one student to drive shared edits and all participants follow those edits.
- Instructor can enable personal-copy editing for multiple students simultaneously.
- Instructor can choose any authorized student's personal copy as the broadcast source for all viewers.
- Instructor takeover preserves student personal edits by default and requires explicit apply/discard to affect shared files.
- Diverged student copies are handled with explicit replace/apply/discard actions and no automatic merge behavior.
- Promotion (`Apply Student Copy to Shared`) is instructor-only.
- `Replace`/`Keep`/`Discard` support both student self-actions and instructor-managed per-student/global workflows, with all-files or per-file scope.
- Students can always switch between `Instructor Copy` and `My Copy`; when no personal copy exists, `My Copy` transparently falls back to instructor content.
- Roster badges/styling accurately reflect live collaboration state.

## Key Reference Files
- [algorithm-demo/server/routes.ts](activities/algorithm-demo/server/routes.ts) - server route pattern
- [algorithm-demo/client/manager/DemoManager.tsx](activities/algorithm-demo/client/manager/DemoManager.tsx) - manager WebSocket + state pattern
- [algorithm-demo/client/student/DemoStudent.tsx](activities/algorithm-demo/client/student/DemoStudent.tsx) - student sync pattern
- [useResilientWebSocket.ts](client/src/hooks/useResilientWebSocket.ts) - WebSocket hook
- [SessionHeader](client/src/components/common/SessionHeader.tsx) - shared header component
- [Modal](client/src/components/ui/Modal.tsx) - shared modal component

## Verification
1. `npm test` — all unit tests pass, including:
   - New activity in `EXPECTED_ACTIVITIES` lists (both client and server)
   - `fileUtils` unit tests (tree building, path validation, normalization)
   - `themeUtils` unit tests (cookie read/write round-trip)
   - Zip safety unit tests (size limits, path traversal, binary skip, artifact filtering)
   - Session normalizer unit test (default group creation, invalid data reset)
2. `npm run build` — client builds successfully with new `activity-mobcode-*.js` chunk
3. Manual: start `npm run dev`, create mobcode session, upload a zip, open student view in second browser, verify real-time sync of edits/file switches/tree changes
4. Manual: download zip, verify file contents match editor state
5. Manual: change theme via settings sprocket, reload page, verify theme persists from cookie
