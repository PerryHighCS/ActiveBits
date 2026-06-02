# Issue 261: Resonance Staged Reveal Mode

## Issue

GitHub issue: https://github.com/PerryHighCS/ActiveBits/issues/261

Resonance multiple-choice questions should support a staged reveal presentation mode:

- Phase 1: show only the question stem. Students can read, think, and discuss, but cannot submit.
- Phase 2: the teacher reveals the answer choices. Students can then submit.
- The existing response timer should begin, or become active, when choices are revealed.

The default behavior should remain unchanged for standard multiple-choice questions.

## Proposed Teacher-Facing Behavior

Add a presentation mode option for a Resonance question set or live run:

- Standard: show each active question using the current Resonance behavior.
- Staged: present questions one at a time in a Kahoot-style sequence. Multiple-choice questions start with the stem visible, then the teacher reveals the choices and students can submit.

Possible labels from the issue:

- Reveal Choices
- Think First
- Staged Question

Initial implementation: use `Presentation mode` with options `Standard` and `Staged` at the question-set/run level.

## Open Product Tweaks

These are intentionally left easy to revise before implementation:

- Should staged reveal be configured per question, per activation/run, or both? Prefer per-set/per-run presentation mode. SyncDeck embedded activities need to be able to configure this launch mode. Per-question metadata may still be useful only if a mixed-mode set becomes a future requirement.
- Should the manager have one global "Reveal choices" button for all active staged questions, or one button per active question? Use one contextual control for the current staged question, since staged runs present one question at a time. The question list can still show per-question staged status.
- If multiple questions are active, should staged mode reveal all choices at once or reveal each question independently? if multiple questions are active, staged mode should reveal questions one at a time, first stem, first responses, second stem, second responses, etc.
- Should free-response questions ignore presentation mode entirely, or should they display a disabled control explaining that staged reveal applies only to multiple choice? Free response can ignore the presentation mode.
- Should the student stem-only phase show a status message such as "Choices will appear when your teacher reveals them"? No.
- Should the teacher see a stem-only preview before activating, or only after activation? before
- Instructor display of student responses should default to order submitted (first responder first). This can be a default for all questions, not just staged response questions.

## Refined Direction

Treat staged reveal as a presentation mode for a question set/live run:

- Standard run: preserve current Resonance behavior, including activating one or more questions together.
- Staged run: present questions sequentially.
- The manager should show one contextual action for the current staged question, such as reveal choices or advance to the next question.
- The question list should show per-question status across the staged sequence.
- For each staged multiple-choice question:
  - show the stem first
  - wait for the teacher to reveal choices
  - start/activate the response timer on reveal
  - collect responses
  - allow the teacher to advance to the next question
- Free-response questions can participate in the sequence using normal free-response behavior, but they do not need a reveal-choices phase.
- SyncDeck embedded launches should be able to request the staged presentation mode in their activity payload.

## Implementation Plan

- [x] Model staged reveal in Resonance set/run contracts: add a presentation mode for question sets and live activations, plus live staged-run state for current question, choices-revealed status, sequence position, and deadlines.
- [x] Update validation, import/export, SyncDeck embedded payload handling, and student-safe snapshot normalization so staged mode is valid, persisted, and launchable from embedded activity payloads.
- [x] Add instructor controls in the Resonance builder/manager for selecting set/run presentation mode, previewing stem-only presentation, revealing choices, and advancing through staged runs with accessible button/state semantics.
- [x] Update student rendering so staged MCQs show stem-only first, disable/delay answer drafting/submission until choices are revealed, and show the existing countdown only after reveal activates the timer.
- [x] Wire server routes and WebSocket handling for staged runs: authenticate instructors, start/advance staged sequences, reveal choices, compute deadlines at reveal time, broadcast state, and reject student submissions/drafts before reveal.
- [x] Add focused tests across shared validation, server routes, student hook normalization, manager helpers/components, and student MCQ view behavior; include explicit `[TEST]` logs for intentional error-path checks if any noisy failures are exercised.
- [x] Run targeted Resonance activity tests first, then activity lint/typecheck, and finish with the repo-appropriate verification gate from `AGENTS.md`; record any sandbox limitations in validation notes.

## Verification Notes

- `npm --workspace activities run test:file -- activities/resonance/shared/validation.test.ts`
- `npm --workspace activities run test:file -- activities/resonance/client/hooks/useResonanceSession.test.ts`
- `npm --workspace activities run test:file -- activities/resonance/client/student/QuestionInputs.test.tsx`
- `npm --workspace activities run test:file -- activities/resonance/server/routes.test.ts`
- `npm --workspace activities run test:file -- activities/resonance/client/index.test.ts`
- `npm_config_target=activities/resonance npm --workspace activities run lint:scope`
- `npm_config_target=activities/resonance npm --workspace activities run test:scope`
- `npm run typecheck --workspace activities`
- `npm --workspace activities test`
- `npm --workspace activities run lint`
