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
- Keep reporting activity-owned for now. The current repo does not have a shared
  `reporting` config field or a generic report-section registration system.

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

- Shared cross-activity report framework.
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
  soloMode: false,
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
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}
```

Notes:

- `deepLinkOptions` is not required if Resonance owns the permanent-link modal UI.
- `deepLinkGenerator` is still needed so the activity-owned builder can submit validated question
  data to an authoritative server endpoint that returns the final persistent URL.
- Resonance should not use `soloMode: true` for its builder/report tool.
- The current config schema can carry metadata for a non-solo utility surface, but the app needs an
  explicit non-solo utility route/entry convention for Resonance rather than reusing `/solo/...`.
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
   `{ hash, url }`.
8. Dashboard/session-creation success state uses the returned URL directly.

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

- Reports are implemented directly by activity-owned UI and server flow.
- There is no shared activity report registration API in `types/activity.ts`.

Plan direction:

- Add a Resonance-specific report view/component under a separate Resonance tool flow, not the
  live manager view.
- Add a Resonance-specific export endpoint or download action under
  `activities/resonance/server/routes.ts`.
- HTML export is required.
- JSON export may also be included because it can be loaded by the utility view/tooling flow.
- If a second activity later needs the same HTML/JSON report composition contract, extract the
  shared type only then.

### Manager and Tooling Split

The manager route should focus on live session facilitation only.

Plan direction:

- `/manage/resonance/:sessionId` should show the live instructor view only.
- Question-set building/import/export should live in a separate Resonance utility tool.
- Report viewing/export should also live in that separate utility tool, similar in spirit to the
  Gallery Walk review-tool product pattern.
- The separate Resonance utility tool should use an explicit non-solo route/entry pattern rather
  than the current `/solo/:activityId` route.
- The live manager should still include a header/action area with the controls needed to launch or
  navigate to the separate builder/report tool.
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

### Phase 1: Activity Skeleton

- [ ] Create `activities/resonance/` directory skeleton.
- [ ] Add `activity.config.ts` using current `ActivityConfig` fields only.
- [ ] Set `manageDashboard.customPersistentLinkBuilder: true`.
- [ ] Set `createSessionBootstrap.sessionStorage` for `instructorPasscode`.
- [ ] Add stub `client/index.tsx` exporting manager, student, and persistent-link builder entry points.
- [ ] Add stub `server/routes.ts`.
- [ ] Keep Resonance behind `isDev: true` until the activity is ready for broader discovery.

### Phase 2: Shared Types and Validation

- [ ] Add `shared/types.ts` with question, response, reveal, and snapshot types.
- [ ] Add `shared/emojiSet.ts`.
- [ ] Add Resonance-local report types in `shared/reportTypes.ts`.
- [ ] Add request/response validation helpers for question sets, student registration, and answer payloads.
- [ ] Record any finalized REST or WS contract details in `.agent/knowledge/data-contracts.md`.
- [ ] Define the route/entry pattern for the separate Resonance utility tool.
- [ ] Introduce or document the explicit non-solo utility route/entry pattern needed for Resonance.
- [ ] Treat Gallery Walk as a product-pattern reference only, not as a routing precedent.

### Phase 3: Permanent Links and Session Bootstrap

- [ ] Implement `POST /api/resonance/create` returning `{ id, instructorPasscode }`.
- [ ] Implement `ResonancePersistentLinkBuilder` using `ActivityPersistentLinkBuilderProps`.
- [ ] Expose the permalink builder in the Resonance session-creation UI.
- [ ] Support JSON and Gimkit-compatible CSV upload in the session-creation UI.
- [ ] Build one shared upload/import component for session creation and permalink creation.
- [ ] Allow the session-creation UI to create either an ad-hoc live session or a permanent link
      from the uploaded question set.
- [ ] Support JSON and Gimkit-compatible CSV upload in the builder.
- [ ] Parse and validate imported files client-side before enabling link generation.
- [ ] Implement `POST /api/resonance/generate-link`.
- [ ] Validate imported question payloads server-side in `POST /api/resonance/generate-link`.
- [ ] Compress serialized question payloads before encryption to keep query payloads smaller.
- [ ] Encrypt question sets in the persistent-link flow for obscuration.
- [ ] Store the encrypted question payload in URL query data because there is no other persistent
      store available for this workflow.
- [ ] Use URL-safe encoding for encrypted query payload transport.
- [ ] Add payload-size validation/failure handling for oversized question sets.
- [ ] Add `server/questionCrypto.ts` with tests for round-trip, tamper detection, and compressed payload handling.
- [ ] Implement `GET /api/resonance/:sessionId/instructor-passcode` for persistent-link instructor recovery.

### Phase 4: Student Lifecycle

- [ ] Implement `POST /api/resonance/:sessionId/register-student`.
- [ ] Build `NameEntryForm.tsx` and student-side `sessionStorage` bootstrap.
- [ ] Implement `ResonanceStudent.tsx` and question rendering flow.
- [ ] Support answer submission for free-response and multiple-choice questions.
- [ ] Ensure student-visible snapshots never expose `isCorrect` before reveal.

### Phase 5: Live Instructor Workflow

- [ ] Build `ResonanceManager.tsx`.
- [ ] Keep the manager focused on live view only.
- [ ] Include a manager header/action area with buttons/links needed to open the separate
      Resonance tool for question-set editing and report access.
- [ ] Build response review UI with student names visible only to instructors.
- [ ] For MCQ private review, support a table-style view such as `name | a | b | c | d`, with the
      student's selected answer shown in correct/incorrect styling when the question has a correct answer.
- [ ] For free-response private review, support a reorderable table that includes student name,
      response content, and instructor annotations.
- [ ] Allow instructor-side response reordering in private review.
- [ ] Add private star / flag / emoji annotations.
- [ ] When an instructor intentionally shares a response, allow the instructor emoji annotation to
      appear with that shared response for students.
- [ ] Keep instructor star/flag state private in both live student views and exported shared results.
- [ ] Support MCQ poll mode without a required correct answer.
- [ ] Add question activation and ad-hoc question creation.
- [ ] Allow instructors to set or change question response time limits during live session management.
- [ ] Add share-results flow that broadcasts anonymous shared responses plus correct-answer reveal.
- [ ] For poll-style MCQs, include shared choice percentages and a pie chart in the first implementation.

### Phase 6: Builder and Report Tooling

- [ ] Build the separate Resonance tool shell for question-set editing/import/export and report access.
- [ ] Build `QuestionBuilder.tsx` and `QuestionCard.tsx` in the tool flow.
- [ ] Allow instructors to set a response time limit while authoring each question.
- [ ] Add JSON and Gimkit-compatible CSV import/export for question sets.
- [ ] Build the Resonance report view in the tool flow rather than the live manager route.

### Phase 7: WebSocket Protocol

- [ ] Implement `/ws/resonance` with instructor and student auth flows.
- [ ] Use the versioned outer envelope with `activity: 'resonance'`.
- [ ] Namespace semantic message types with `resonance:`.
- [ ] Send instructor-safe and student-safe snapshots on connect.
- [ ] Broadcast reaction updates for shared responses.
- [ ] Add focused server tests for REST and websocket behavior.

### Phase 8: Reporting

- [ ] Implement `GET /api/resonance/:sessionId/report`.
- [ ] Ship HTML report export in the first implementation.
- [ ] Optionally add JSON export for utility-view loading and tooling reuse.
- [ ] Reuse Resonance-local `reportUtils.ts` for shared calculations only if both client and server need the same transforms.
- [ ] Do not introduce a shared repo-wide report contract unless another activity needs the same abstraction.

### Phase 9: Verification

- [ ] Add unit tests for request validation, websocket handlers, and persistent-link flow.
- [ ] Add client tests for builder UX, student registration, and reveal behavior.
- [ ] Run activity-scoped tests plus lint/typecheck for changed workspaces.
- [ ] Run `npm test` before merge when the change crosses workspaces.

## Open Decisions

- What should the route and navigation shape of the separate Resonance utility tool be?
- Should the utility tool load JSON reports only from exports/files, or also support direct
  session-linked loading flows?
