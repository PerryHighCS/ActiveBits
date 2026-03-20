# Resonance Plan

This document tracks the current Resonance implementation plan and is intentionally aligned with
the repository's current activity conventions and `ActivityConfig` schema.

## Current Alignment

Resonance should follow the same containment and dashboard patterns used by newer activities:

- Keep activity-specific behavior under `activities/resonance/...`.
- Reuse the existing `ActivityConfig` surface instead of proposing new top-level schema fields.
- Use `manageDashboard.customPersistentLinkBuilder` plus an activity-owned
  `PersistentLinkBuilderComponent` for complex permanent-link UX.
- Use `createSessionBootstrap.sessionStorage` for instructor bootstrap values returned by session
  creation endpoints.
- Follow Gallery Walk as a product-pattern precedent for activity-owned helper tooling, but not as
  a routing convention.
- Keep reporting UI and export rendering activity-owned, while reusing the current lightweight
  shared reporting seams: `ActivityConfig.reportEndpoint`, `ActivityStructuredReportSection`, and
  `registerActivityReportBuilder(...)` when Resonance needs to participate in embedded/session
  report aggregation.

## Scope

### In Scope

- Instructor question builder for free-response and multiple-choice questions. - using utility/tools link on home page
- Question set JSON and csv import/export. CSV should be gimkit compatible.
  - Gimkit csv first row is a single title cell, normally "Gimkit Spreadsheet Import Template", but can be anything
  - second row column titles: "Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"
  - third row on - one question per row
- Permanent links that preserve a question set using an activity-owned deep-link flow.
  - Incorporate a link builder plus JSON/CSV upload into both the session-creation flow and the instructor utility editor
- Instructor bootstrap via session-created passcode stored in `sessionStorage`.
- Student name registration.
- Student answer submission.
- Instructor review tools:
  - private star / flag / emoji annotations
  - include student names and response
    - table format for mcqs should have name | a | b | c | d (for example) with student response shown in red/green for correct/incorrect
    - free-response questions should also support a table-based instructor review
    - instructor can reorder responses in instructor private review
  - sharing of selected answers anonymously with all students
  - instructor emoji annotations can be intentionally shared to students as part of the shared response view
  - instructor star/flag annotations remain private and never share to students
  - correct-answer reveal for multiple-choice questions
- Poll questions / mcq without a "correct" answer
  - when shared, show student choice percentages and a pie chart
- Student reactions to shared answers.
- Instructor can set and change question response time limits during question creation and live play.
- Activity-owned report/export flow for Resonance session results.
- Embedded-activity-friendly websocket envelope and message namespacing.

### Out of Scope

- New shared cross-activity reporting framework additions beyond the current `reportEndpoint` and
  structured report builder conventions.
- New `ActivityConfig.reporting` or `types/report.ts` schema additions.
- Cross-session persistence beyond existing session and persistent-link behavior.
- Shared websocket multiplexing with parent sessions.
- Question reordering.

## ActivityConfig Direction

Resonance should target the current `ActivityConfig` contract:

```ts
const resonanceConfig: ActivityConfig = {
  id: 'resonance',
  name: 'Resonance',
  description: 'Collect, review, and share class responses in real time',
  color: 'rose',
  standaloneEntry: {
    enabled: false,
    supportsDirectPath: false,
    supportsPermalink: false,
    showOnHome: false,
  },
  deepLinkGenerator: {
    endpoint: '/api/resonance/generate-link',
    mode: 'replace-url',
    expectsSelectedOptions: false,
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'resonance_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
  },
  manageDashboard: {
    customPersistentLinkBuilder: true,
  },
  reportEndpoint: '/api/resonance/:sessionId/report',
  utilMode: true,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}
```

Notes:

- `deepLinkOptions` is not required if Resonance owns the permanent-link modal UI.
- `deepLinkGenerator` is still needed so the activity-owned builder can submit validated question
  data to an authoritative server endpoint that returns the final persistent URL.
- `reportEndpoint` should advertise the activity-owned HTML export route so shared embedded-session
  surfaces can discover it without importing Resonance-specific server code.
- The current config schema can carry metadata for a non-solo utility surface, and Resonance
  should target an explicit `/util/...` route/entry convention rather than reusing `/solo/...`.
- The dashboard should stay activity-agnostic. Question-set authoring, validation, and upload flow
  belong in Resonance-owned components.
- If Resonance later needs extra dashboard integration, prefer evolving
  `ActivityPersistentLinkBuilderProps` only after a second activity needs the same capability.

## Architecture Decisions

### Permanent Link Flow

Resonance should use an activity-owned builder, similar to SyncDeck's modern pattern:

1. Instructor can open Resonance permalink building from the session-creation UI or from the
   separate Resonance utility tool.
2. Session creation and permalink creation should share the same upload/import component so JSON
   and Gimkit CSV parsing, preview, and validation only exist in one place.
3. `PersistentLinkBuilderComponent` handles question-set import or authoring.
4. The builder accepts uploaded JSON and Gimkit-compatible CSV instead of trying to build complex
   questions inside the shared dashboard UI.
5. The builder performs client-side parsing and validation, shows question summary/errors, and only
   enables submission when the imported data is valid.
6. The builder posts plaintext `Question[]` plus `teacherCode` to
   `POST /api/resonance/generate-link`.
7. The server performs final validation, encrypts the payload, and returns the authoritative
   persistent-link result consumed by `onCreated(...)`, including the final URL, hash, and teacher
   code.
8. The builder should support both create and edit flows through
   `ActivityPersistentLinkBuilderProps`, including `editState` when an existing persistent session
   is being updated.
9. Dashboard/session-creation success state uses the returned authoritative URL directly.

This keeps question-set-specific UX and validation inside the activity instead of adding special
branches to shared dashboard code.

Because the repo does not have any other persistent store for this workflow, the encrypted
question payload should live in URL query data for persistent links.

Resonance should not rely on the current shared `deepLinkGenerator.preflight` hook for uploaded
question-set validation. That hook fits lightweight field checks, while Resonance needs richer
file parsing/import validation. Validation should happen in two places:

- client-side inside the custom persistent-link builder
- server-side inside `POST /api/resonance/generate-link`

### Instructor Bootstrap

Resonance session creation should return `instructorPasscode`, and `createSessionBootstrap` should
store it in `sessionStorage` using key prefix `resonance_instructor_`.

Two flows should be supported:

1. Ad-hoc dashboard session creation via `POST /api/resonance/create`.
2. Persistent-link manager entry that can recover the passcode from a Resonance-owned endpoint
   after teacher-cookie verification.

### Question Set Protection

Resonance persistent links should encrypt question payloads. This encryption is primarily for
obscuration so answer metadata is not trivially readable in the URL or copied link text.

Current implementation guidance:

- Serialize and compress question payloads before encryption to reduce URL size.
- Keep encryption activity-owned in `activities/resonance/server/questionCrypto.ts`.
- Reuse `PERSISTENT_SESSION_SECRET`-derived key material.
- Bind ciphertext to the persistent hash as associated data.
- Use a URL-safe encoded output format after compression/encryption for query transport.
- Add payload-size guardrails because even compressed question sets may still exceed practical URL limits.
- Treat this as obscuration rather than a long-term secure storage boundary.
- Do not invent new shared crypto abstractions unless a second activity needs them.

### Reporting

Resonance should ship an activity-owned report/export path first.

Current repo convention:

- Activity-owned report downloads are advertised through `ActivityConfig.reportEndpoint`.
- Embedded/session-level aggregation uses shared structured report types such as
  `ActivityStructuredReportSection`.
- Activities that need to contribute structured report data to shared containers can register a
  server builder with `registerActivityReportBuilder(...)`.
- Report UI, HTML document structure, auth policy, and activity-specific calculations remain owned
  by the activity.

Plan direction:

- Add a Resonance-specific report view/component under a separate Resonance tool flow, not the
  live manager view.
- Add a Resonance-specific export endpoint or download action under
  `activities/resonance/server/routes.ts`.
- HTML export is required.
- JSON export may also be included because it can be loaded by the utility view/tooling flow.
- Set `reportEndpoint` in `activity.config.ts` when the route exists.
- If Resonance is later embedded in SyncDeck or another aggregate-report host, add a
  Resonance-owned structured report builder that returns `ActivityStructuredReportSection` instead
  of inventing a new reporting contract.
- Do not add new top-level `ActivityConfig.reporting` or parallel report-schema abstractions unless
  a new cross-activity need appears that the current `reportEndpoint` + structured-builder pattern
  cannot cover.

### Manager and Tooling Split

The manager route should focus on live session facilitation only.

Plan direction:

- `/manage/resonance/:sessionId` should show the live instructor view only.
- Question-set building/import/export should live in a separate Resonance utility tool under
  `/util/resonance`.
- Report viewing/export should also live in that separate utility tool, similar in spirit to the
  Gallery Walk review-tool product pattern.
- The separate Resonance utility tool should use the repo's existing `/util/...` route/entry
  pattern (`utilMode` + `UtilComponent`) rather than the older `/solo/:activityId` path.
- The live manager should still include a header/action area with the controls needed to launch or
  navigate to the separate builder/report tool.
- The `/` selector/join surface should continue to rely on the normal activity config discovery
  pattern; the extra work is making the same utility entry discoverable from `/manage`.
- The session-creation flow should also expose Resonance permalink building so instructors can
  upload a JSON or Gimkit CSV file and create a permanent link without first entering the separate
  utility tool.
- The session-creation flow should also support JSON/CSV upload for ordinary Resonance session
  creation, not just permanent-link generation.

### WebSocket Envelope

Resonance should keep the versioned outer envelope already documented for embeddable activities:

```ts
{
  version: '1'
  activity: 'resonance'
  sessionId: string
  type: string
  timestamp: number
  payload: unknown
}
```

Resonance-specific message types should continue using a `resonance:` prefix.

## Proposed Data Model

```ts
export type QuestionType = 'free-response' | 'multiple-choice'

export interface MCQOption {
  id: string
  text: string
  isCorrect?: boolean
}

export interface BaseQuestion {
  id: string
  type: QuestionType
  text: string
  order: number
  responseTimeLimitMs?: number | null
}

export interface FreeResponseQuestion extends BaseQuestion {
  type: 'free-response'
}

export interface MCQQuestion extends BaseQuestion {
  type: 'multiple-choice'
  options: MCQOption[]
}

export type Question = FreeResponseQuestion | MCQQuestion

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
  answer: AnswerPayload
  sharedAt: number
  instructorEmoji: string | null
  reactions: Record<string, number>
}

export interface QuestionReveal {
  questionId: string
  sharedAt: number
  correctOptionIds: string[] | null
  sharedResponses: SharedResponse[]
}
```

Resonance-specific report data should stay local to the activity for now, for example in
`activities/resonance/shared/reportTypes.ts`.

## Proposed REST + WS Contracts

### REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/resonance/create` | — | Create session and return `{ id, instructorPasscode }` |
| `POST` | `/api/resonance/:sessionId/register-student` | — | Register student name and return `{ studentId, name }` |
| `GET` | `/api/resonance/:sessionId/instructor-passcode` | teacher cookie | Recover instructor passcode for persistent-link flow |
| `POST` | `/api/resonance/generate-link` | — | Create authoritative permanent link from `teacherCode` + `Question[]` |
| `GET` | `/api/resonance/:sessionId/state` | — | Return student-safe snapshot |
| `GET` | `/api/resonance/:sessionId/responses` | instructor auth | Return instructor-visible responses and annotations |
| `GET` | `/api/resonance/:sessionId/report` | instructor auth | Return Resonance HTML export; JSON export may be added alongside it |

### WebSocket Messages

Server to clients:

- `resonance:question-activated`
- `resonance:results-shared`
- `resonance:reaction-updated`
- `resonance:session-state`
- `resonance:question-added`
- `resonance:instructor-state`
- `resonance:response-received`
- `resonance:annotation-updated`

Client to server:

- `resonance:activate-question`
- `resonance:share-results`
- `resonance:annotate-response`
- `resonance:update-question-timer`
- `resonance:add-question`
- `resonance:submit-answer`
- `resonance:react-to-shared`

## File Layout

```text
activities/resonance/
├── activity.config.ts
├── shared/
│   ├── types.ts
│   ├── emojiSet.ts
│   ├── reportTypes.ts
│   └── reportUtils.ts
├── client/
│   ├── index.tsx
│   ├── manager/
│   │   ├── ResonanceManager.tsx
│   │   ├── ResponseViewer.tsx
│   │   └── ResponseCard.tsx
│   ├── tools/
│   │   ├── ResonanceToolShell.tsx
│   │   ├── ResonanceQuestionSetUploader.tsx
│   │   ├── QuestionBuilder.tsx
│   │   ├── QuestionCard.tsx
│   │   ├── CreatePersistentLinkModal.tsx
│   │   ├── ResonancePersistentLinkBuilder.tsx
│   │   └── ResonanceReport.tsx
│   ├── student/
│   │   ├── ResonanceStudent.tsx
│   │   ├── NameEntryForm.tsx
│   │   ├── QuestionView.tsx
│   │   ├── FreeResponseInput.tsx
│   │   ├── MCQInput.tsx
│   │   └── SharedResponseFeed.tsx
│   ├── components/
│   │   ├── EmojiPicker.tsx
│   │   └── ...
│   └── hooks/
│       └── useResonanceSession.ts
└── server/
    ├── routes.ts
    ├── questionCrypto.ts
    └── reportRenderer.ts
```

## Implementation Checklist

### Phase 1: Activity Skeleton ✅

- [x] Create `activities/resonance/` directory skeleton.
- [x] Add `activity.config.ts` using current `ActivityConfig` fields only.
- [x] Set `manageDashboard.customPersistentLinkBuilder: true`.
- [x] Set `createSessionBootstrap.sessionStorage` for `instructorPasscode`.
- [x] Add stub `client/index.tsx` exporting manager, student, and persistent-link builder entry points.
- [x] Add stub `server/routes.ts`.
- [x] Keep Resonance behind `isDev: true` until the activity is ready for broader discovery.

### Phase 2: Shared Types and Validation ✅

- [x] Add `shared/types.ts` with question, response, reveal, and snapshot types.
- [x] Add `shared/emojiSet.ts`.
- [x] Add Resonance-local report types in `shared/reportTypes.ts`.
- [x] Add request/response validation helpers for question sets, student registration, and answer payloads.
- [x] Record any finalized REST or WS contract details in `.agent/knowledge/data-contracts.md`.
- [x] Wire Resonance into the existing `/util/...` route/entry pattern with `utilMode` and a `UtilComponent`.
- [x] Treat Gallery Walk as a product-pattern reference only, not as a routing precedent.
- [x] Add utility cards/entry points for Resonance to the `/manage` dashboard, mirroring the
      existing activity-config-driven discovery already available from `/`.

### Phase 3: Permanent Links and Session Bootstrap ✅

- [x] Implement `POST /api/resonance/create` returning `{ id, instructorPasscode }`.
- [x] Implement `ResonancePersistentLinkBuilder` using `ActivityPersistentLinkBuilderProps`.
- [x] Support both create-mode and edit-mode builder flows via `editState`, preserving activity-owned validation on updates as well as creates.
- [x] Expose the permalink builder in the Resonance session-creation UI.
- [x] Support JSON and Gimkit-compatible CSV upload in the session-creation UI.
- [x] Build one shared upload/import component for session creation and permalink creation.
- [x] Allow the session-creation UI to create either an ad-hoc live session or a permanent link
      from the uploaded question set.
- [x] Support JSON and Gimkit-compatible CSV upload in the builder.
- [x] Parse and validate imported files client-side before enabling link generation.
- [x] Implement `POST /api/resonance/generate-link`.
- [x] Validate imported question payloads server-side in `POST /api/resonance/generate-link`.
- [x] Return an authoritative persistent-link result that maps cleanly onto `onCreated(...)` (`fullUrl`, `hash`, `teacherCode`, and any persisted `selectedOptions` as needed).
- [x] Compress serialized question payloads before encryption to keep query payloads smaller.
- [x] Encrypt question sets in the persistent-link flow for obscuration.
- [x] Store the encrypted question payload in URL query data because there is no other persistent
      store available for this workflow.
- [x] Use URL-safe encoding for encrypted query payload transport.
- [x] Add payload-size validation/failure handling for oversized question sets.
- [x] Add `server/questionCrypto.ts` with tests for round-trip, tamper detection, and compressed payload handling.
- [x] Implement `GET /api/resonance/:sessionId/instructor-passcode` for persistent-link instructor recovery.

### Phase 4: Student Lifecycle ✅

- [x] Implement `POST /api/resonance/:sessionId/register-student`.
- [x] Build `NameEntryForm.tsx` and student-side `sessionStorage` bootstrap.
      Note: waiting room (`waitingRoom.fields`) is the primary name-collection path;
      `NameEntryForm` is a fallback for direct-URL access.
- [x] Implement `ResonanceStudent.tsx` and question rendering flow.
- [x] Support answer submission for free-response and multiple-choice questions.
      Note: uses REST (`POST /api/resonance/:sessionId/submit-answer`) until Phase 7 adds WS.
- [x] Ensure student-visible snapshots never expose `isCorrect` before reveal.

### Phase 5: Live Instructor Workflow ✅

- [x] Build `ResonanceManager.tsx`.
- [x] Keep the manager focused on live view only.
- [x] Include a manager header/action area with buttons/links needed to open the separate
      Resonance tool for question-set editing and report access.
- [x] Build response review UI with student names visible only to instructors.
- [x] For MCQ private review, support a table-style view such as `name | a | b | c | d`, with the
      student's selected answer shown in correct/incorrect styling when the question has a correct answer.
- [x] For free-response private review, support a reorderable table that includes student name,
      response content, and instructor annotations.
- [x] Allow instructor-side response reordering in private review.
- [x] Add private star / flag / emoji annotations.
- [x] When an instructor intentionally shares a response, allow the instructor emoji annotation to
      appear with that shared response for students.
- [x] Keep instructor star/flag state private in both live student views and exported shared results.
- [x] Support MCQ poll mode without a required correct answer.
- [x] Add question activation and ad-hoc question creation.
- [x] Allow instructors to set or change question response time limits during live session management.
- [x] Add share-results flow that broadcasts anonymous shared responses plus correct-answer reveal.
- [ ] For poll-style MCQs, include shared choice percentages and a pie chart in the first implementation.
      Note: percentage bars are implemented on the student side; pie chart deferred to a follow-up.

### Phase 6: Builder and Report Tooling ✅

- [x] Build the separate Resonance tool shell for question-set editing/import/export and report access.
- [x] Build `QuestionBuilder.tsx` and `QuestionCard.tsx` in the tool flow.
- [x] Allow instructors to set a response time limit while authoring each question.
- [x] Add JSON and Gimkit-compatible CSV import/export for question sets.
- [x] Build the Resonance report view in the tool flow rather than the live manager route.

### Phase 7: WebSocket Protocol ✅

- [x] Implement `/ws/resonance` with instructor and student auth flows.
- [x] Use the versioned outer envelope with `activity: 'resonance'`.
- [x] Namespace semantic message types with `resonance:`.
- [x] Send instructor-safe and student-safe snapshots on connect.
- [x] Broadcast reaction updates for shared responses.
- [ ] Add focused server tests for REST and websocket behavior. (deferred to Phase 9)
      Note: WS push upgrades useResonanceSession and useInstructorState; polling used as
      infrequent fallback while reconnecting; submit-answer keeps REST path for error feedback.

### Phase 8: Reporting ✅

- [x] Implement `GET /api/resonance/:sessionId/report`.
- [x] Ship HTML report export in the first implementation.
- [x] Optionally add JSON export for utility-view loading and tooling reuse. (?format=json)
- [x] Set `reportEndpoint` in `activities/resonance/activity.config.ts` once the route is implemented.
- [ ] If Resonance needs SyncDeck/session-level aggregation, register a Resonance report builder that returns `ActivityStructuredReportSection`. (deferred — not yet needed)
- [ ] Reuse Resonance-local `reportUtils.ts` for shared calculations only if both client and server need the same transforms. (not needed — calculations stay server-side)
- [x] Do not introduce a new repo-wide report contract unless the current `reportEndpoint` plus structured report builder conventions prove insufficient.

### Phase 9: Verification ✅

- [ ] Add unit tests for request validation, websocket handlers, and persistent-link flow.
      Note: validation and crypto already have tests from Phase 3; WS handler tests deferred.
- [ ] Add client tests for builder UX, student registration, and reveal behavior.
      Note: no client test infrastructure currently; deferred.
- [x] Run activity-scoped tests plus lint/typecheck for changed workspaces.
- [x] Run `npm test` before merge when the change crosses workspaces. All passing.

## Open Decisions

- Should the utility tool load JSON reports only from exports/files, or also support direct
  session-linked loading flows? Current implementation: file-only.

## Resolved Issues

### Permalink URL Format (fixed)

`POST /api/resonance/generate-link` previously returned a malformed URL
(`/manage/resonance?h=HASH&q=ENCODED`) instead of the platform-standard
`/activity/resonance/HASH?q=ENCODED&h=HASH&entryPolicy=instructor-required&urlHash=...`.

Fix applied:
- Added `deepLinkOptions: { q: {}, h: {} }` to `activity.config.ts` so the platform's
  `getCanonicalPersistentLinkSelectedOptions` preserves both fields from URL query params.
- `generate-link` now calls `getOrCreateActivePersistentSession` and
  `updatePersistentSessionUrlState` to pre-load `selectedOptions: { q, h }` in the persistent store.
- URL built with `buildPersistentLinkUrlQuery` and formatted as `/activity/resonance/HASH?...`.
- Cookie updated to include `selectedOptions`, `entryPolicy`, and `urlHash` for platform compatibility.
- `normalizeSessionData` extended to decrypt `embeddedLaunch.selectedOptions.{ q, h }` when the
  platform WS creates the session (questions empty, embeddedLaunch present), populating
  `session.data.questions` and `session.data.persistentHash`.
