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
- Keep reporting activity-owned for now. The current repo does not have a shared
  `reporting` config field or a generic report-section registration system.

## Scope

### In Scope

- Instructor question builder for free-response and multiple-choice questions.
- Question set JSON import/export.
- Permanent links that preserve a question set using an activity-owned deep-link flow.
- Instructor bootstrap via session-created passcode stored in `sessionStorage`.
- Student name registration.
- Student answer submission.
- Instructor review tools:
  - private star / flag / emoji annotations
  - anonymous sharing of selected answers
  - correct-answer reveal for multiple-choice questions
- Student reactions to shared answers.
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
- The dashboard should stay activity-agnostic. Question-set authoring, validation, and upload flow
  belong in Resonance-owned components.
- If Resonance later needs extra dashboard integration, prefer evolving
  `ActivityPersistentLinkBuilderProps` only after a second activity needs the same capability.

## Architecture Decisions

### Permanent Link Flow

Resonance should use an activity-owned builder, similar to SyncDeck's modern pattern:

1. Instructor opens the dashboard permanent-link modal.
2. `PersistentLinkBuilderComponent` handles question-set import or authoring.
3. The builder posts plaintext `Question[]` plus `teacherCode` to
   `POST /api/resonance/generate-link`.
4. The server returns the authoritative `{ hash, url }`.
5. Dashboard success state uses the returned URL directly.

This keeps question-set-specific UX and validation inside the activity instead of adding special
branches to shared dashboard code.

### Instructor Bootstrap

Resonance session creation should return `instructorPasscode`, and `createSessionBootstrap` should
store it in `sessionStorage` using key prefix `resonance_instructor_`.

Two flows should be supported:

1. Ad-hoc dashboard session creation via `POST /api/resonance/create`.
2. Persistent-link manager entry that can recover the passcode from a Resonance-owned endpoint
   after teacher-cookie verification.

### Question Set Protection

The older plan proposed encrypted question payloads in the persistent link. That remains a valid
direction if Resonance embeds answer metadata such as `isCorrect`.

Current implementation guidance:

- Keep encryption activity-owned in `activities/resonance/server/questionCrypto.ts`.
- Reuse `PERSISTENT_SESSION_SECRET`-derived key material.
- Bind ciphertext to the persistent hash as associated data.
- Do not invent new shared crypto abstractions unless a second activity needs them.

### Reporting

Resonance should ship an activity-owned report/export path first.

Current repo convention:

- Reports are implemented directly by the activity manager/server flow.
- There is no shared activity report registration API in `types/activity.ts`.

Plan direction:

- Add a Resonance-specific report view/component under `activities/resonance/client/...`.
- Add a Resonance-specific export endpoint or download action under
  `activities/resonance/server/routes.ts`.
- If a second activity later needs the same HTML/JSON report composition contract, extract the
  shared type only then.

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
| `GET` | `/api/resonance/:sessionId/report` | instructor auth | Return Resonance-owned report payload or downloadable export |

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
│   │   ├── QuestionBuilder.tsx
│   │   ├── QuestionCard.tsx
│   │   ├── CreatePersistentLinkModal.tsx
│   │   ├── ResonancePersistentLinkBuilder.tsx
│   │   ├── ResponseViewer.tsx
│   │   └── ResponseCard.tsx
│   ├── student/
│   │   ├── ResonanceStudent.tsx
│   │   ├── NameEntryForm.tsx
│   │   ├── QuestionView.tsx
│   │   ├── FreeResponseInput.tsx
│   │   ├── MCQInput.tsx
│   │   └── SharedResponseFeed.tsx
│   ├── components/
│   │   ├── EmojiPicker.tsx
│   │   └── ResonanceReport.tsx
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

### Phase 3: Permanent Links and Session Bootstrap

- [ ] Implement `POST /api/resonance/create` returning `{ id, instructorPasscode }`.
- [ ] Implement `ResonancePersistentLinkBuilder` using `ActivityPersistentLinkBuilderProps`.
- [ ] Implement `POST /api/resonance/generate-link`.
- [ ] Decide whether question sets are encrypted in the persistent-link flow.
- [ ] If encrypted, add `server/questionCrypto.ts` with tests for round-trip and tamper detection.
- [ ] Implement `GET /api/resonance/:sessionId/instructor-passcode` for persistent-link instructor recovery.

### Phase 4: Student Lifecycle

- [ ] Implement `POST /api/resonance/:sessionId/register-student`.
- [ ] Build `NameEntryForm.tsx` and student-side `sessionStorage` bootstrap.
- [ ] Implement `ResonanceStudent.tsx` and question rendering flow.
- [ ] Support answer submission for free-response and multiple-choice questions.
- [ ] Ensure student-visible snapshots never expose `isCorrect` before reveal.

### Phase 5: Live Instructor Workflow

- [ ] Build `ResonanceManager.tsx`.
- [ ] Build `QuestionBuilder.tsx` and `QuestionCard.tsx`.
- [ ] Add JSON import/export for question sets.
- [ ] Build response review UI with student names visible only to instructors.
- [ ] Add private star / flag / emoji annotations.
- [ ] Add question activation and ad-hoc question creation.
- [ ] Add share-results flow that broadcasts anonymous shared responses plus correct-answer reveal.

### Phase 6: WebSocket Protocol

- [ ] Implement `/ws/resonance` with instructor and student auth flows.
- [ ] Use the versioned outer envelope with `activity: 'resonance'`.
- [ ] Namespace semantic message types with `resonance:`.
- [ ] Send instructor-safe and student-safe snapshots on connect.
- [ ] Broadcast reaction updates for shared responses.
- [ ] Add focused server tests for REST and websocket behavior.

### Phase 7: Reporting

- [ ] Implement a Resonance-owned report view under `activities/resonance/client/...`.
- [ ] Implement `GET /api/resonance/:sessionId/report`.
- [ ] Choose initial export format:
  - [ ] HTML download
  - [ ] JSON export
  - [ ] both
- [ ] Reuse Resonance-local `reportUtils.ts` for shared calculations only if both client and server need the same transforms.
- [ ] Do not introduce a shared repo-wide report contract unless another activity needs the same abstraction.

### Phase 8: Verification

- [ ] Add unit tests for request validation, websocket handlers, and persistent-link flow.
- [ ] Add client tests for builder UX, student registration, and reveal behavior.
- [ ] Run activity-scoped tests plus lint/typecheck for changed workspaces.
- [ ] Run `npm test` before merge when the change crosses workspaces.

## Open Decisions

- Should Resonance persistent links store encrypted question payloads in the URL, in server-side
  persistent-session metadata, or in another teacher-authenticated store?
- Should the first report export be HTML, JSON, or both?
- Does Resonance need a manager tab layout, or should report/download actions live inline like
  existing activity-owned report flows?
