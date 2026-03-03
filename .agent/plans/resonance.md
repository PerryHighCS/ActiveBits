# Resonance Activity – Implementation Plan

## Overview

**Resonance** is a question-and-answer activity designed to work both standalone and as an
embedded activity inside presentations (e.g. SyncDeck). The instructor poses questions, collects
student responses in real time, annotates them privately, and can share selected answers
anonymously with the class. Students can react to shared answers with emoji.

Because Resonance is intended as an embeddable activity, all WebSocket messages use a
`resonance:` prefix and carry complete self-contained payloads so they can be demultiplexed
from a shared socket in a future embedding architecture.

Resonance is the first activity to generate a structured **report**. The reporting contract is
designed generically so future activities—and a future combined-session report—can follow the
same interface.

---

## Scope

**In scope:**
- Instructor question builder (free-response, multiple-choice; extensible to future types)
- Question set download/upload as JSON (plaintext; for local use only)
- Persistent links that embed the question set as **server-side encrypted** query data
- Ad-hoc question addition during a live session
- Student name collection (visible to instructor, hidden from other students)
- Student answering (free-response and MCQ)
- Instructor response viewer with star / flag / emoji annotations, student name visible
- Anonymous response sharing (no name) with live per-student emoji reactions
- Correct-answer reveal: when the instructor shares results for a question, the correct answer
  is broadcast to all students simultaneously
- Curated emoji picker (shared between instructor and student)
- Standalone session report (in-app view + JSON download)
- Generic reporting contract (`types/report.ts`) for future cross-activity reports

**Out of scope (future work):**
- Shared websocket multiplexing with parent session (contract is designed to allow it)
- Cross-session/embedded-activity session linking
- Persistent response storage between sessions
- Question reordering

---

## Architecture Decisions

### Activity Reporting Config Flag

A new optional `reporting` field is added to `ActivityConfig` (in `types/activity.ts`) and
validated in `types/activityConfigSchema.ts`. It is an object so individual capabilities can
be opted into independently and new modes can be added without a breaking schema change.

```typescript
// types/activity.ts (addition to ActivityConfig)
reporting?: {
  /** Activity can generate a standalone report from instructor-managed sessions */
  standalone?: boolean
  /** Activity can contribute a report section when embedded inside another activity */
  embedded?: boolean
  /** Solo-mode sessions can generate reports (future) */
  solo?: boolean
}
```

Usage in the manager UI: the **Report** tab is shown only when `reporting.standalone` is
`true`. The `ActivityHtmlReportSection` function is registered per-activity alongside the
React component (future combined-report assembler checks `reporting.embedded`).

Resonance sets `reporting: { standalone: true }`.

### Server-Side HTML Generation – Why Not React/Vite SSR

`react-dom/server`'s `renderToStaticMarkup` runs in Node.js without Next.js or Vite. However,
two constraints make it a poor fit for self-contained HTML reports in this codebase:

1. **React is not a server dependency.** The server's `package.json` does not include
   `react` or `react-dom`, and its `tsconfig.json` targets `NodeNext` with no JSX/DOM libs.
   Adding React solely for report rendering would be a disproportionate dependency.

2. **Tailwind v4 CSS lives only inside the Vite pipeline.** The project uses
   `@tailwindcss/vite`, which generates CSS at Vite build time. A server-rendered React
   component would emit class names with no corresponding styles — the generated HTML would
   not be self-contained without a separate CSS extraction build step.

**Decision:** The server HTML renderer (`server/reportRenderer.ts`) uses plain TypeScript
template-string functions, not React. It embeds its own minimal inline CSS block scoped to
the report. Data-processing logic (tallies, response grouping, summary calculations) is
extracted into `shared/reportUtils.ts` and imported by both the server renderer and the
React in-app component, preventing duplication without coupling the rendering approaches.

This does not preclude using React SSR in the future — if a report component with inline
`style=` props (no Tailwind) is written, `renderToStaticMarkup` can be dropped in as the
generator for that component. The `ActivityHtmlReportSection` contract accepts any
implementation.

### Instructor Authentication – Two Flows

Resonance follows the same two-flow passcode pattern as SyncDeck.

**Ad-hoc (dashboard) flow:**
1. `POST /api/resonance/create` generates a random `instructorPasscode` (`randomBytes(16).toString('hex')`) and returns it with the session ID.
2. `activity.config.ts` declares `createSessionBootstrap.sessionStorage` so the shared dashboard stores the passcode in `sessionStorage` under key `resonance_instructor_{sessionId}` automatically.
3. `ResonanceManager` reads the passcode from sessionStorage and passes it as `?role=instructor&instructorPasscode=...` in the WS URL.
4. Server verifies with `timingSafeEqual` on connect.

**Persistent link flow:**
1. Instructor builds question set and creates a persistent link via `ResonancePersistentLinkBuilder`.
2. The builder POSTs to `/api/resonance/generate-link`, which encrypts the question set and creates the persistent link, returning the authoritative URL.
3. When the instructor later visits the persistent link, the manager calls
   `GET /api/resonance/:sessionId/instructor-passcode` (protected by teacher-code cookie verification, mirroring SyncDeck's endpoint).
4. The endpoint returns `{ instructorPasscode }`, which is stored in sessionStorage and used for WS auth as in the ad-hoc flow.

### Question Set Encryption

MCQ options may carry a correct-answer indicator, and future question types may contain
additional answer metadata. To prevent this data from being readable in the URL, the question
set is **encrypted server-side** before being embedded in persistent link query params.

**Algorithm:** AES-256-GCM (authenticated encryption)
- Key: 32-byte key derived from `PERSISTENT_SESSION_SECRET` using HKDF-SHA256 with a
  fixed info label `resonance-question-key`.
- IV: 12 random bytes generated per encryption.
- Additional authenticated data (AAD): the persistent link hash, binding the ciphertext
  to that specific link so it cannot be transplanted to another link.
- Wire format: `base64(iv || authTag || ciphertext)`, stored as the `questions` query param.

**Encryption happens only on the server** in `server/questionCrypto.ts`. The client never sees
or touches ciphertext—it sends plaintext `Question[]` to the server endpoint and the server
encrypts it. On session creation from a persistent link, the server decrypts the param before
seeding the session.

### Student Identity

Students register with a name before joining. The name is:
- Stored server-side with the student's session-scoped ID token.
- Visible to the instructor in the response viewer.
- **Never** included in shared responses broadcast to all clients.

Registration follows the same REST + WS pattern as SyncDeck:
1. Student POSTs to `/api/resonance/:sessionId/register-student` with `{ name }`.
2. Server returns `{ studentId, name }`; both stored in sessionStorage.
3. Student connects to WS with `?sessionId=...&studentId=...`.

### Message Namespacing
All outbound/inbound WS message `type` fields use the `resonance:` prefix so future
multiplexing can route messages to the correct activity without parsing payload content.

### Correct-Answer Reveal

Sharing responses and revealing the correct answer are a **single instructor action** per
question ("Share Results"). When the instructor triggers it:

1. The server broadcasts `resonance:results-shared` to all clients, which carries:
   - The anonymised shared responses for that question.
   - For MCQ questions: the ID(s) of the correct option(s), sourced from `MCQOption.isCorrect`
     in the encrypted question set.
   - For free-response questions: no correct-answer field (there is no single right answer).
2. Students see the shared responses **and** the correct-answer indicator in the same update,
   so they cannot be received separately or out of order.
3. The session records `revealedAt` per question so reconnecting students receive the correct
   answer in the session snapshot if results have already been shared.

This replaces the per-response `resonance:share-response` + separate `resonance:correct-answer-revealed`
approach—one message per question is simpler and avoids timing races on the student side.

The instructor can still annotate individual responses (star/flag/emoji) at any time; those
annotations are private and unrelated to the share-results action.

### Reporting Contract

A new shared file `types/report.ts` defines the two-layer reporting contract:

**Layer 1 – In-app React view:**
`ActivityReportSectionProps<TData>` is the props interface for an activity-owned React component
that renders inside the manager's **Report** tab. It uses the app's normal styling (Tailwind).

**Layer 2 – Self-contained HTML export:**
`ActivityHtmlReportSection<TData>` is a function type that takes an `ActivityReportSegment<TData>`
and returns a plain HTML string fragment (a `<section>` block, no `<html>`/`<head>`/`<body>`).
The fragment must be entirely self-contained: all styles must be inline or inside a `<style>`
block scoped to the fragment; no external stylesheets, no CDN fonts, no runtime JS.

A top-level report assembler (future cross-activity use) collects fragments from multiple
activities, injects a shared CSS reset and document shell, and produces one `<!DOCTYPE html>`
file. For Resonance's standalone download, the server wraps its own fragment in the full shell.

The `ResonanceReportData` JSON is embedded verbatim in a `<script>` tag at the top of the
document so the file is self-describing even if opened in a context where the HTML markup
is not rendered (e.g., extracted by a script).

**HTML report generation is server-side** (`server/reportRenderer.ts`) using template strings,
not React (see "Server-Side HTML Generation" decision above). The server has authoritative
access to all session data including instructor annotations. Shared data-processing logic
(tallies, grouping, summaries) lives in `shared/reportUtils.ts` and is imported by both
the server renderer and the in-app React component. The endpoint streams the assembled HTML
directly (`Content-Type: text/html; Content-Disposition: attachment; filename="resonance-report.html"`).

Resonance implements `ResonanceReportData` as the first concrete segment type.

---

## File Structure

```
activities/resonance/
├── activity.config.ts
├── shared/
│   ├── types.ts              # All shared TypeScript types (questions, responses, etc.)
│   ├── emojiSet.ts           # Curated emoji list used by picker
│   ├── reportTypes.ts        # Resonance-specific ResonanceReportData type
│   └── reportUtils.ts        # Pure data-processing functions shared by server renderer
│                             #   and in-app React component (tallies, grouping, summaries)
├── client/
│   ├── index.tsx
│   ├── manager/
│   │   ├── ResonanceManager.tsx                # Manager shell + WS + passcode bootstrap
│   │   ├── QuestionBuilder.tsx                 # Build/edit/upload question set; includes
│   │   │                                       #   "Create Persistent Link" button
│   │   ├── QuestionCard.tsx                    # Single question editor card
│   │   ├── CreatePersistentLinkModal.tsx       # Teacher-code entry + link generation from
│   │   │                                       #   current question set (used in manager)
│   │   ├── ResponseViewer.tsx                  # Live responses per active question
│   │   ├── ResponseCard.tsx                    # Single response + annotation controls
│   │   └── ResonancePersistentLinkBuilder.tsx  # Dashboard "Make Permanent Link" modal:
│   │                                           #   upload JSON only → generate link
│   ├── student/
│   │   ├── ResonanceStudent.tsx          # Student shell + name registration + WS
│   │   ├── NameEntryForm.tsx             # Name prompt before joining
│   │   ├── QuestionView.tsx              # Display active question + submit form
│   │   ├── FreeResponseInput.tsx         # Text answer component
│   │   ├── MCQInput.tsx                  # Multiple choice component
│   │   └── SharedResponseFeed.tsx        # Shared answers + reaction controls
│   ├── components/
│   │   ├── EmojiPicker.tsx               # Reusable emoji picker (curated set)
│   │   └── ResonanceReport.tsx           # Standalone + embeddable report view
│   └── hooks/
│       └── useResonanceSession.ts        # WS lifecycle + message dispatch hook
└── server/
    ├── routes.ts                         # API endpoints + WS handler
    ├── questionCrypto.ts                 # AES-256-GCM encrypt/decrypt for question sets
    └── reportRenderer.ts                 # Self-contained HTML report generator
                                          #   implements ActivityHtmlReportSection<ResonanceReportData>
```

New shared type file at repo root:
```
types/report.ts     # Generic reporting contract
```

---

## WebSocket Message Protocol

All messages: `{ type: string; payload: unknown }`.

### Server → All Clients

| Type | Payload | Notes |
|------|---------|-------|
| `resonance:question-activated` | `{ questionId: string \| null }` | Instructor changed active question |
| `resonance:results-shared` | `{ questionId: string; sharedResponses: SharedResponse[]; correctOptionIds: string[] \| null }` | All shared responses + correct answer (null for free-response); sent when instructor shares results for a question |
| `resonance:reaction-updated` | `{ sharedResponseId: string; reactions: Record<string, number> }` | Live reaction counts |
| `resonance:session-state` | `{ snapshot: StudentSessionSnapshot }` | Student-safe state on connect |
| `resonance:question-added` | `{ question: StudentQuestion }` | Ad-hoc question added |

### Server → Instructor Only

| Type | Payload | Notes |
|------|---------|-------|
| `resonance:instructor-state` | `{ snapshot: InstructorSessionSnapshot }` | Full state incl. responses + names |
| `resonance:response-received` | `{ response: ResponseWithName }` | Includes student name |
| `resonance:annotation-updated` | `{ responseId: string; annotation: InstructorAnnotation }` | |

### Client → Server (Instructor)

| Type | Payload | Notes |
|------|---------|-------|
| `resonance:activate-question` | `{ questionId: string \| null }` | |
| `resonance:share-results` | `{ questionId: string; responseIds: string[] }` | Share selected responses + reveal correct answer simultaneously |
| `resonance:annotate-response` | `{ responseId: string; annotation: Partial<InstructorAnnotation> }` | Private; never broadcast to students |
| `resonance:add-question` | `{ question: NewQuestion }` | Ad-hoc addition |

### Client → Server (Student)

| Type | Payload | Notes |
|------|---------|-------|
| `resonance:submit-answer` | `{ questionId: string; answer: AnswerPayload }` | One per question per student |
| `resonance:react-to-shared` | `{ sharedResponseId: string; emoji: string }` | Toggle; server deduplicates |

---

## Data Types (shared/types.ts sketch)

```typescript
export type QuestionType = 'free-response' | 'multiple-choice'

export interface MCQOption {
  id: string
  text: string
  isCorrect?: boolean  // instructor-only; stripped before sending to students
}

export interface BaseQuestion {
  id: string
  type: QuestionType
  text: string
  order: number
}

export interface FreeResponseQuestion extends BaseQuestion { type: 'free-response' }
export interface MCQQuestion extends BaseQuestion {
  type: 'multiple-choice'
  options: MCQOption[]
}
export type Question = FreeResponseQuestion | MCQQuestion

/** MCQ options sent to students – isCorrect is omitted */
export type StudentMCQOption = Omit<MCQOption, 'isCorrect'>
export type StudentQuestion =
  | FreeResponseQuestion
  | (Omit<MCQQuestion, 'options'> & { options: StudentMCQOption[] })

export type AnswerPayload =
  | { type: 'free-response'; text: string }
  | { type: 'multiple-choice'; selectedOptionId: string }

export interface Response {
  id: string
  questionId: string
  studentId: string
  submittedAt: number
  answer: AnswerPayload
}

/** Response as sent to instructor – includes student name */
export interface ResponseWithName extends Response {
  studentName: string
}

export interface InstructorAnnotation {
  starred: boolean
  flagged: boolean
  emoji: string | null
}

export interface SharedResponse {
  id: string
  questionId: string
  answer: AnswerPayload   // anonymous – no studentId or name
  sharedAt: number
  reactions: Record<string, number>  // emoji → count
}

/** Per-question reveal state; present once instructor has shared results */
export interface QuestionReveal {
  questionId: string
  sharedAt: number
  /** IDs of correct MCQ options; null for free-response questions */
  correctOptionIds: string[] | null
  sharedResponses: SharedResponse[]
}

export interface StudentSessionSnapshot {
  questions: StudentQuestion[]     // isCorrect stripped
  activeQuestionId: string | null
  /** Keyed by questionId; present only for questions whose results have been shared */
  reveals: Record<string, QuestionReveal>
}

export interface InstructorSessionSnapshot extends StudentSessionSnapshot {
  questions: Question[]            // full, including isCorrect
  responses: ResponseWithName[]    // all responses with names
  annotations: Record<string, InstructorAnnotation>  // responseId → annotation
  // reveals inherited from StudentSessionSnapshot; instructor sees same reveal state
}
```

---

## Reporting Contract (types/report.ts)

```typescript
export interface ActivityReportMeta {
  activityId: string
  activityName: string
  sessionId: string
  generatedAt: number
}

export interface ActivityReportSegment<TData = unknown> {
  meta: ActivityReportMeta
  data: TData
}

/** Props for an activity-owned React component rendered in the manager Report tab */
export interface ActivityReportSectionProps<TData = unknown> {
  segment: ActivityReportSegment<TData>
}

/**
 * Function an activity implements to produce a self-contained HTML fragment.
 * Rules:
 *  - Return a single root element (e.g. <section>), not a full document.
 *  - All styles must be inside an inline <style> block or style attributes.
 *  - No external URLs (no CDN, no web fonts, no external images).
 *  - No runtime JS required to render the content; JS is optional and must be inline.
 *  - The raw segment data should be embedded as a JSON literal in a <script> block
 *    at the start of the fragment so the file is self-describing.
 */
export type ActivityHtmlReportSection<TData = unknown> = (
  segment: ActivityReportSegment<TData>,
) => string
```

Resonance-specific report data (`activities/resonance/shared/reportTypes.ts`):
```typescript
export interface ResonanceReportData {
  questions: Question[]
  responses: Record<string, ResponseWithName[]>       // questionId → responses with names
  annotations: Record<string, InstructorAnnotation>  // responseId → annotation
  reveals: Record<string, QuestionReveal>             // questionId → reveal (if shared)
}
```

---

## REST API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/resonance/create` | — | Create session; returns `{ id, instructorPasscode }` |
| `POST` | `/api/resonance/:sessionId/register-student` | — | Register student name; returns `{ studentId, name }` |
| `GET` | `/api/resonance/:sessionId/instructor-passcode` | teacher-code cookie | Persistent-link passcode recovery (mirrors SyncDeck endpoint) |
| `POST` | `/api/resonance/generate-link` | — | Encrypt question set + create persistent link; returns `{ hash, url }` |
| `GET` | `/api/resonance/:sessionId/state` | — | Student-safe session state snapshot |
| `GET` | `/api/resonance/:sessionId/responses` | instructor passcode | All responses with names + annotations |
| `GET` | `/api/resonance/:sessionId/report` | instructor passcode | Self-contained HTML report (`text/html`; `Content-Disposition: attachment; filename="resonance-report.html"`); data embedded inline |

WS endpoint: `/ws/resonance?sessionId=...` (instructor adds `&role=instructor&instructorPasscode=...`)

---

## Question Encryption – Server Detail

`server/questionCrypto.ts` exports:

```typescript
// Key derivation: HKDF-SHA256 from PERSISTENT_SESSION_SECRET, label 'resonance-question-key'
function deriveKey(secret: string): Buffer

// Encrypts questions bound to a specific persistent hash (used as AAD)
export function encryptQuestions(questions: Question[], persistentHash: string): string
// Returns: base64(iv[12] || authTag[16] || ciphertext)

// Decrypts; throws if AAD mismatch or tampering detected
export function decryptQuestions(encoded: string, persistentHash: string): Question[]
```

The `/api/resonance/generate-link` endpoint calls `encryptQuestions` and stores the result as
`selectedOptions.questions` in the persistent-session cookie (same pattern as SyncDeck storing
`presentationUrl`). On session creation from a persistent link, the create endpoint calls
`decryptQuestions` to seed the session.

`MCQOption.isCorrect` travels through the encryption round-trip intact. When students connect,
the server strips `isCorrect` from all options before sending the question set.

---

## Implementation Checklist

### Phase 1 – Foundation
- [ ] Add `reporting?: { standalone?: boolean; embedded?: boolean; solo?: boolean }` to
      `ActivityConfig` in `types/activity.ts`
- [ ] Add `reporting` schema validation to `types/activityConfigSchema.ts`
- [ ] Create `activities/resonance/` directory skeleton
- [ ] Write `shared/types.ts` with all domain types (incl. `StudentQuestion`, `ResponseWithName`,
      both snapshot types)
- [ ] Write `shared/emojiSet.ts` with curated emoji array
- [ ] Write `shared/reportTypes.ts` with `ResonanceReportData`
- [ ] Write `types/report.ts` with generic reporting contract
      (`ActivityReportSegment`, `ActivityReportSectionProps`, `ActivityHtmlReportSection`)
- [ ] Create `activity.config.ts` with `isDev: true`, `reporting: { standalone: true }`, and
      `createSessionBootstrap.sessionStorage` for instructor passcode
- [ ] Create stub `server/routes.ts` (session create only, no WS yet)
- [ ] Create stub `client/index.tsx` with placeholder components
- [ ] Note: `resonance` stays out of `EXPECTED_ACTIVITIES` until Phase 9 (covered by `isDev`)

### Phase 2 – Question Crypto (Server)
- [ ] Write `server/questionCrypto.ts`:
  - [ ] `deriveKey(secret)` using HKDF-SHA256
  - [ ] `encryptQuestions(questions, persistentHash)` → base64 ciphertext
  - [ ] `decryptQuestions(encoded, persistentHash)` → `Question[]`
- [ ] Unit tests for crypto round-trip (valid, tampered AAD, corrupted ciphertext)

### Phase 3 – Server Core
- [ ] `POST /api/resonance/create`:
  - [ ] Generate `instructorPasscode` via `randomBytes(16).toString('hex')`
  - [ ] If `questions` present in body, `decryptQuestions` and seed session
  - [ ] Return `{ id, instructorPasscode }`
- [ ] `POST /api/resonance/:sessionId/register-student`:
  - [ ] Validate + store student name + generate `studentId`
  - [ ] Return `{ studentId, name }`
- [ ] `GET /api/resonance/:sessionId/instructor-passcode`:
  - [ ] Verify persistent hash → teacher-code cookie (mirror SyncDeck logic)
  - [ ] Return `{ instructorPasscode }`
- [ ] `POST /api/resonance/generate-link`:
  - [ ] Accept `{ activityName, teacherCode, questions: Question[] }`
  - [ ] Call `encryptQuestions` to produce ciphertext
  - [ ] Create persistent session (calling shared persistent-session logic)
  - [ ] Store `{ questions: ciphertext }` in selectedOptions cookie entry
  - [ ] Return `{ hash, url }`
- [ ] `GET /api/resonance/:sessionId/state` – return `StudentSessionSnapshot` (isCorrect stripped)
- [ ] `GET /api/resonance/:sessionId/responses` – verify passcode header, return full data
- [ ] `GET /api/resonance/:sessionId/report` – verify passcode header, return `ResonanceReportData`
- [ ] Session normalizer registered
- [ ] WebSocket handler at `/ws/resonance`:
  - [ ] Parse `role`, `instructorPasscode`, `studentId` from query
  - [ ] Instructor connect: verify passcode with `timingSafeEqual`; send `resonance:instructor-state`
  - [ ] Student connect: look up registered student by `studentId`; send `resonance:session-state`
    (strip `isCorrect` from questions)
  - [ ] `resonance:activate-question` → broadcast `resonance:question-activated`
  - [ ] `resonance:submit-answer` → store response; push `resonance:response-received` to instructors
  - [ ] `resonance:annotate-response` → update annotation; send `resonance:annotation-updated` to instructor
  - [ ] `resonance:share-results` → build `QuestionReveal` (strip student names; derive `correctOptionIds`
        from `MCQOption.isCorrect`; null for free-response); persist in session; broadcast
        `resonance:results-shared` to all clients
  - [ ] `resonance:react-to-shared` → toggle reaction; broadcast `resonance:reaction-updated`
  - [ ] `resonance:add-question` (instructor) → append question; broadcast `resonance:question-added`
- [ ] Server unit tests for all routes and WS message handlers

### Phase 4 – Instructor Question Builder
- [ ] `ResonanceManager.tsx`:
  - [ ] Reads `instructorPasscode` from sessionStorage (or fetches from
        `/api/resonance/:sessionId/instructor-passcode` for persistent-link flow)
  - [ ] Three-tab layout: **Build** / **Live** / **Report**
  - [ ] `SessionHeader` integration
  - [ ] `useResonanceSession` hook wiring
- [ ] `QuestionCard.tsx` – edit question text, type selector, MCQ option list with isCorrect toggle
- [ ] `QuestionBuilder.tsx`:
  - [ ] Ordered list of `QuestionCard`s with add/remove buttons
  - [ ] Upload question set from JSON (file input, validate against `Question[]` schema)
  - [ ] Download current question set as JSON (plaintext, for local backup)
  - [ ] "Create Persistent Link" button (disabled when list is empty; opens `CreatePersistentLinkModal`)

### Phase 5 – Student Answering Flow
- [ ] `NameEntryForm.tsx` – name input; POST to register-student; store `studentId`+`name` in sessionStorage
- [ ] `ResonanceStudent.tsx` – check for `studentId` in sessionStorage; show name form if absent; WS connect
- [ ] `QuestionView.tsx` – route to correct input by `question.type`
- [ ] `FreeResponseInput.tsx` – textarea + submit; lock after submit per question
- [ ] `MCQInput.tsx` – option buttons (no `isCorrect` visible); lock after submit
- [ ] Show "waiting for a question" when `activeQuestionId` is null
- [ ] Handle `resonance:question-activated` → reset submitted state
- [ ] `useResonanceSession` hook (student side)

### Phase 6 – Live Response View (Instructor)
- [ ] `ResponseViewer.tsx` – per-question response list; student names visible
- [ ] MCQ aggregate bar (option counts as percentage) above the individual response list
- [ ] `ResponseCard.tsx` – answer text + student name + star toggle + flag toggle + emoji button
- [ ] `EmojiPicker.tsx` – popover with curated emoji grid; keyboard-navigable
- [ ] Sending `resonance:annotate-response` on annotation change
- [ ] Per-question **Share Results** button → sends `resonance:share-results` with selected
      response IDs; button disabled once results already shared for that question
- [ ] After sharing, instructor view shows which responses were shared and the correct answer
      indicator (same reveal state students see)
- [ ] Ad-hoc question add UI in **Live** tab

### Phase 7 – Shared Response Feed & Student Reactions
- [ ] `SharedResponseFeed.tsx` – renders when `reveals[questionId]` is present:
  - [ ] Lists anonymously shared responses (no name shown)
  - [ ] For MCQ: highlights correct option(s) using `correctOptionIds`
  - [ ] For free-response: no correct-answer indicator
- [ ] Handle `resonance:results-shared` → merge into `reveals` state; update student MCQ
      input view to show correct answer if already submitted
- [ ] Per-shared-response emoji picker for students (same `EmojiPicker` component)
- [ ] Live reaction count display (grouped by emoji)
- [ ] Client-side deduplication guard (one reaction per student per shared response,
      tracked in component state; server authoritative via `resonance:reaction-updated`)

### Phase 8 – Reporting

**In-app React view (`ResonanceReport.tsx`):**
- [ ] Implements `ActivityReportSectionProps<ResonanceReportData>` (Tailwind styles, live data)
  - [ ] Per-question section header with response count
  - [ ] MCQ section: option tally + percentage bar; correct option highlighted if results were shared
  - [ ] Free-response section: response list with instructor annotations (star/flag/emoji)
  - [ ] Reveal section per question: shared responses with reaction counts; correct answer noted
- [ ] **Report** tab in manager renders `ResonanceReport` using data from WS session state
      (tab visible because `activity.config.ts` sets `reporting.standalone: true`)

**Shared data utilities (`shared/reportUtils.ts`):**
- [ ] `tallyCounts(responses, question)` – option-count map for MCQ, used by both renderer and React component
- [ ] `groupResponsesByQuestion(responses)` – `Record<questionId, ResponseWithName[]>`
- [ ] Unit tests for all utility functions

**Self-contained HTML report (`server/reportRenderer.ts`):**
- [ ] Implements `ActivityHtmlReportSection<ResonanceReportData>`
- [ ] Uses `shared/reportUtils.ts` for data processing; no React dependency
- [ ] Produces a `<section>` HTML fragment containing:
  - [ ] `<script>const RESONANCE_REPORT = /* JSON literal */;</script>` at the top
  - [ ] `<style>` block with all report styles using plain CSS (no Tailwind, no external sheets)
  - [ ] Static HTML markup for all questions, responses, MCQ tallies, reveals, and annotations
  - [ ] Emoji annotations rendered as text characters (no image/CDN dependency)
- [ ] `GET /api/resonance/:sessionId/report` assembles the fragment into a full
      `<!DOCTYPE html>` document (with a shared CSS reset inline) and serves it as
      `text/html; Content-Disposition: attachment; filename="resonance-report.html"`
- [ ] "Download Report" button in the **Report** tab triggers this endpoint
- [ ] Unit tests: `reportRenderer.ts` produces valid HTML with embedded JSON for a known dataset;
      no `http://` or `https://` URLs appear in the output
- [ ] Document reporting contract and self-contained HTML rules in `.agent/knowledge/data-contracts.md`

### Phase 9 – Persistent Links & Deep Linking

There are two separate entry points for creating a persistent link, each for a different
instructor workflow:

**A. Dashboard "Make Permanent Link" modal (`ResonancePersistentLinkBuilder`):**
Used when the instructor has not yet started a session. They upload an existing JSON file.

- [ ] `ResonancePersistentLinkBuilder.tsx`:
  - [ ] JSON file upload input (no question builder UI here)
  - [ ] Parse and validate uploaded file against `Question[]` schema; show error on invalid file
  - [ ] Show question count summary after valid upload
  - [ ] Teacher code input
  - [ ] POST to `/api/resonance/generate-link` with parsed questions + teacher code
  - [ ] Display resulting URL on success

**B. Manager "Create Persistent Link" button (`CreatePersistentLinkModal`):**
Used from within an active ad-hoc session. The instructor has already built or uploaded
questions in the **Build** tab and wants to save the current question set as a persistent link.

- [ ] `CreatePersistentLinkModal.tsx`:
  - [ ] Triggered by a "Create Persistent Link" button in the **Build** tab of `ResonanceManager`
  - [ ] Shows a summary of the current session's question set (read-only)
  - [ ] Teacher code input
  - [ ] POST to `/api/resonance/generate-link` with the current session's question set + teacher code
  - [ ] Display resulting URL on success
- [ ] "Create Persistent Link" button in `QuestionBuilder.tsx` (disabled when question list is empty)

**Shared backend:**
- [ ] Update `activity.config.ts`:
  - [ ] `manageDashboard.customPersistentLinkBuilder: true`
  - [ ] `isDev: false`
- [ ] On session create from persistent link: server decrypts `selectedOptions.questions` and seeds session
- [ ] Add `'resonance'` to `EXPECTED_ACTIVITIES` in both test files
- [ ] Full `npm test` pass

### Phase 10 – Polish & Accessibility
- [ ] Accessibility audit:
  - [ ] All interactive controls have labels / ARIA attributes
  - [ ] MCQ options use `role="radio"` / `aria-checked`
  - [ ] Star and flag toggles use `aria-pressed`
  - [ ] Emoji picker uses `role="grid"` or `role="listbox"` with keyboard navigation
  - [ ] Shared response reaction buttons use `aria-label` with emoji name + count
- [ ] `npm test` clean pass
- [ ] Record crypto design, student-name data flow, and reporting contract in `.agent/knowledge/`
- [ ] Update `DEPLOYMENT.md` noting that Resonance requires `PERSISTENT_SESSION_SECRET`
      (same as existing SyncDeck constraint — no new env vars added, but confirm documented)

---

## Definition of Done

- [ ] All Phase 1–10 checklist items completed
- [ ] `npm test` passes with no regressions
- [ ] `resonance` appears in the management dashboard
- [ ] Instructor can build a question set, encrypt it into a persistent link, and have it seeded on session start
- [ ] Students register with a name; names appear in instructor response view but not in shared feed
- [ ] Instructor can star, flag, and emoji-annotate responses; can share responses anonymously
- [ ] When instructor shares results for a question, all students receive shared responses
      and the correct answer (for MCQ) in a single atomic broadcast
- [ ] Students can emoji-react to shared responses; counts update live
- [ ] A report can be viewed and downloaded from the manager **Report** tab
- [ ] Generic `types/report.ts` contract documented in `data-contracts.md`
- [ ] `DEPLOYMENT.md` confirms `PERSISTENT_SESSION_SECRET` requirement covers Resonance
