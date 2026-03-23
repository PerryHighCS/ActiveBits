# Embedded Activities In SyncDeck Decks

Use this file when a Reveal deck should launch or coordinate interactive activities from within SyncDeck.

For concrete activity payload formats, also read `ACTIVITY_PAYLOADS.md` in this folder. That reference captures the current deck-facing launch payload shapes used for activities such as Resonance, Video Sync, Algorithm Demo, Gallery Walk, Raffle, and simple embedded test harnesses.

## Core Principle

The deck declares launch intent. The host owns lifecycle.

That means:

- slide markup says what activity should launch
- the parent SyncDeck host decides when to create, reuse, end, and relay to child sessions
- the embedded activity owns its own activity-specific behavior after launch

Avoid putting child-session orchestration logic directly into deck markup.

## Preferred Authoring Pattern

Declare launch intent on the slide:

```html
<section
  data-activity-id="resonance"
  data-activity-trigger="slide-enter"
  data-activity-options='{"questions":[{"id":"q1","type":"free-response","text":"What is one thing you are still uncertain about?","order":0,"responseTimeLimitMs":45000}]}'
>
  <div class="slide-inner">
    <h2>Quick Check-In</h2>
  </div>
</section>
```

Recommended attributes:

- `data-activity-id`: required activity identifier
- `data-activity-trigger`: usually `slide-enter`
- `data-activity-options`: JSON payload for activity-specific launch options
- `data-activity-instance-key`: optional stable override when the host should not derive the instance key from slide position

## Instance Keys

Use stable instance identity so revisit behavior is predictable.

Good default:

- derive the instance key from `activityId` plus slide position

Examples:

- `video-sync:3:0`
- `raffle:5:0`
- `resonance:2:0`

Use an explicit `data-activity-instance-key` only when the deck needs a non-positional identity.

## Slide Enter Behavior

For launch-on-entry slides:

- emit a launch request when the slide becomes active
- avoid permanent deck-side dedupe that prevents relaunch after the host intentionally ends the child activity
- let the host decide whether a request is a no-op because that instance is already active

If deck-side dedupe exists, keep it narrow and tied to the current resolved slide entry event, not a forever-seen history.

## Host Bridge Pattern

When a deck needs to ask the parent host to launch an activity, send a structured custom message through the iframe sync runtime when available.

Example:

```js
window.RevealIframeSyncAPI?.sendCustom?.('activityRequest', {
  activityId: 'resonance',
  instanceKey: 'resonance:2:0',
  trigger: 'slide-enter',
  options: {
    questions: [
      {
        id: 'q1',
        type: 'free-response',
        text: 'What is one thing you are still uncertain about?',
        order: 0,
        responseTimeLimitMs: 45000
      }
    ]
  }
});
```

Payload guidance:

- include `activityId`
- include `instanceKey` when known
- include source indices when helpful for host-side debugging or fallback derivation
- include only the activity launch options the child actually needs
- keep payloads aligned with the activity-specific examples in `ACTIVITY_PAYLOADS.md`

## Child Host Contract

Embedded activities should assume the host may provide sync metadata separate from the launch request itself.

Typical host responsibilities:

- launch the child session
- render the activity overlay or iframe
- relay sync or navigation context
- end or reuse existing child sessions

Typical child responsibilities:

- honor the embedded launch options it was given
- react to host sync context
- keep activity-specific logic self-contained

## Keep Shared Layers Generic

Do not bake activity-specific conditionals into shared Reveal plumbing unless there is an explicitly temporary compatibility reason.

If multiple activities need the same capability:

- define a generic launch contract
- pass activity-specific data in options
- keep the shared layer activity-agnostic

## What To Avoid

- hard-coding child session ids in deck markup
- letting deck JavaScript own backend session lifecycle
- coupling shared slide utilities to one activity implementation
- using raw query-string hacks instead of structured launch payloads

## FRQ and MCQ Slides

Whenever a slide presents a **free-response question (FRQ)** or a **multiple-choice question (MCQ)**, embed a `resonance` activity on the section rather than leaving the question as inert slide content.

- FRQ → `type: "free-response"`
- MCQ → `type: "multiple-choice"` with an `options` array (mark the correct option with `"isCorrect": true`)

The slide still needs fallback content (the question rendered in HTML) for standalone/preview use — see the Fallback Slide Design section below.

---

## Fallback Slide Design for Activity Slides

When a slide embeds an activity, it still needs visible fallback content for standalone/preview contexts (no parent host attached).

Guidelines:

- Include the question or prompt as readable HTML — do not leave the slide blank
- Add a `slide-tag` span (or equivalent) to label the slide type, e.g. `<span class="slide-tag">FRQ</span>` or `<span class="slide-tag">MCQ</span>`
- For MCQ fallbacks: show all options without highlighting the correct answer and without fragment animations — the activity owns answer reveal, not the slide
- For FRQ fallbacks: show the question prompt in a styled box; do not add a text input field — response collection is the activity's job

Example MCQ fallback structure:

```html
<section
  data-activity-id="resonance"
  data-activity-trigger="slide-enter"
  data-activity-instance-key="resonance:5:0"
  data-activity-options='...'>

  <div class="slide-inner">
    <span class="slide-tag">MCQ</span>
    <h2>Question title</h2>
    <ul class="mcq-opts">
      <li><span class="opt-key">A</span> Option text</li>
      <li><span class="opt-key">B</span> Option text</li>
    </ul>
  </div>
</section>
```

---

## Validation Checklist

- activating the slide emits one well-formed request
- revisiting the slide can relaunch after a prior end when intended
- the host can ignore duplicate requests for an already-running instance
- the deck still works as a normal Reveal deck when no parent host is attached
