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
- Write `activity.config.ts` (`id: 'mobcode'`, `color: 'emerald'`, `soloMode: false`)
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
- **zip safety tests** (in a `zipUtils.test.ts` or inline in component test): rejects zip > 10MB; skips `__MACOSX/` and `.DS_Store`; rejects paths with `../` traversal; skips binary files; respects max file count (200) and max per-file size (1MB)
- **session normalizer test** (in `server/routes.test.ts`): normalizer creates `groups.default` when missing; normalizer preserves valid data; normalizer resets invalid `files` to `{}`

Run `npm test` to verify all pass.

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
| Phase 3 | Student editing | Add permissions/turn system; WS messages include editor identity |
| Phase 4 | Breakout groups | Instructor creates named groups, copies `default` files into each; students assigned to groups; each group has independent files/activeFile |

The `groups` map in the data model supports all phases without migration.

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
