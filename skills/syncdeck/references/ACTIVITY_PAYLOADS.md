# Activity Payload Formats

Use this file when a SyncDeck deck needs concrete `data-activity-options` examples for specific activities.

This is a deck-authoring reference, not a full server-side schema contract. Prefer the smallest payload that expresses the activity launch intent clearly.

## Two Related Payload Shapes

There are two closely related but different shapes to keep straight:

1. Deck launch payload
   Passed in slide markup as `data-activity-options='...'` and forwarded in the deck's `activityRequest`.
2. Child embedded launch state
   The sanitized `selectedOptions` or `embeddedLaunch.selectedOptions` that the child activity eventually reads after the host creates or restores the child session.

In some activities those shapes are nearly identical. In others, the host normalizes or transforms the launch payload before the child reads it.

## Resonance

### Deck launch payload

Use plain question data in `data-activity-options`.

Minimal free-response example:

```html
<section
  data-activity-id="resonance"
  data-activity-trigger="slide-enter"
  data-activity-options='{"questions":[{"id":"q1","type":"free-response","text":"What is one thing you are still uncertain about?","order":0,"responseTimeLimitMs":45000}]}'
>
```

Mixed question-set example:

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "free-response",
      "text": "What is one thing you are still uncertain about?",
      "order": 0,
      "responseTimeLimitMs": 45000
    },
    {
      "id": "q2",
      "type": "multiple-choice",
      "text": "How would you rate your understanding so far?",
      "order": 1,
      "responseTimeLimitMs": 30000,
      "options": [
        { "id": "q2a", "text": "Solid — I could explain it", "isCorrect": false },
        { "id": "q2b", "text": "Getting there — mostly clear", "isCorrect": false },
        { "id": "q2c", "text": "Foggy — need more review", "isCorrect": false }
      ]
    }
  ]
}
```

Field guidance:

- `questions` is the main launch payload
- each question should have a stable `id`
- `type` should match the activity's supported question types such as `free-response` or `multiple-choice`
- `order` should be explicit and zero-based
- `responseTimeLimitMs` should be provided when timed launch behavior matters
- multiple-choice questions should carry an `options` array

### Child embedded launch state

Resonance persistent and embedded recovery paths may store encrypted question material in `embeddedLaunch.selectedOptions` under fields such as:

- `q` for encoded question payload
- `h` for the associated hash

That storage shape is a host/runtime detail. Deck authors should usually provide plain `questions` in the launch payload and let the host normalize as needed.

## Video Sync

### Deck launch payload

The core value is a YouTube `sourceUrl`.

Example:

```html
<section
  data-activity-id="video-sync"
  data-activity-trigger="slide-enter"
  data-activity-options='{"sourceUrl":"https://www.youtube.com/watch?v=mCq8-xTH7jA"}'
>
```

Field guidance:

- `sourceUrl` is required
- it should resolve to a valid YouTube video

### Child embedded launch state

Video Sync reads `selectedOptions.sourceUrl` from embedded launch state. Keep that field present and canonical.

## Algorithm Demo

### Recommended launch payload

Use the configured deep-link field:

```html
<section
  data-activity-id="algorithm-demo"
  data-activity-trigger="slide-enter"
  data-activity-options='{"algorithm":"binary-search"}'
>
```

Supported values currently include IDs such as:

- `linear-search`
- `guessing-game`
- `binary-search`
- `selection-sort`
- `insertion-sort`
- `merge-sort`
- `factorial`
- `fibonacci`

### Child embedded launch state

Algorithm Demo reads `embeddedLaunch.selectedOptions.algorithm`.

Note:

- the current conversion-lab deck uses `{"seed":"syncdeck-ui-check"}` as a lightweight conversion-check payload
- for a real authored deck, prefer the activity's actual `algorithm` option unless you intentionally need host-only test metadata

## Gallery Walk

### Deck launch payload

The current sample deck uses a lightweight title seed:

```html
<section
  data-activity-id="gallery-walk"
  data-activity-trigger="slide-enter"
  data-activity-options='{"title":"Embedded critique board"}'
>
```

Practical guidance:

- use `title` when the host flow should seed the child session's display title
- keep additional config lightweight unless the host activity explicitly supports more launch fields

### Child embedded launch state

Gallery Walk currently behaves more like a session-configured embedded activity than a deep-link-heavy one. Treat `title` as a host-seeded config value rather than a broad standalone permalink contract.

## Raffle

The current deck example uses:

```json
{ "title": "Vertical stack raffle branch" }
```

This is a good pattern for simple launchable activities:

- include a small human-readable seed value when the activity benefits from naming or contextual labeling
- avoid over-specifying fields the child activity does not require

## Embedded Test Harness

The current deck example uses:

```json
{ "prompt": "embedded contract smoke check" }
```

Use a tiny payload like this for harness or diagnostics activities where the purpose is contract validation rather than rich child configuration.

## Instance-Key Examples

Current position-based examples from the deck:

- `resonance:2:0`
- `embedded-test:3:0`
- `raffle:3:1`
- `algorithm-demo:3:2`
- `video-sync:4:0`
- `gallery-walk:5:0`

These are derived from `activityId` plus slide position and are usually the best default.

## Authoring Rules

- Prefer activity-specific payloads that match the child activity's real bootstrap fields.
- Avoid using host-only test metadata in polished deck examples unless you clearly label it as such.
- If an activity's deck launch payload and child `selectedOptions` differ, document both shapes.
- When in doubt, keep the deck payload minimal and let the host normalize it.
