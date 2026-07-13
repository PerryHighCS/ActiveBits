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

## Embedded Instructor Manager Bootstrap

SyncDeck starts embedded instructor iframes only after `POST /api/syncdeck/:sessionId/embedded-activity/start` returns a short-lived `managerEntryToken`. Credentialed child managers exchange that single-use token with `GET /api/syncdeck/embedded-manager-passcode?sessionId=<child-session-id>&token=<manager-entry-token>` to receive their child activity passcode. Credentialless managers, such as Raffle, receive an empty `managerBootstrap` object plus the token so the parent can use the same mount/retry lifecycle, but must not redeem the token; the exchange endpoint rejects child sessions without an instructor passcode. This is host-managed runtime state, not deck-authored `data-activity-options`; do not add credentials or bootstrap tokens to deck payloads.

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

Question `text` fields and multiple-choice `options[].text` fields may contain Markdown. Plain text remains valid.

Markdown-formatted question example:

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice",
      "text": "Given this code, what is printed?\n\n```python\nvalues = [2, 4, 6]\nprint(values[1])\n```",
      "order": 0,
      "responseTimeLimitMs": 30000,
      "options": [
        { "id": "q1a", "text": "`2`", "isCorrect": false },
        { "id": "q1b", "text": "`4`", "isCorrect": true },
        { "id": "q1c", "text": "`6`", "isCorrect": false }
      ]
    }
  ]
}
```

Markdown table and image example:

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "free-response",
      "text": "Use the data table to justify your answer.\n\n| Input | Output |\n| ---: | ---: |\n| 1 | 3 |\n| 2 | 5 |\n| 3 | 7 |\n\n![Graph of the pattern](https://example.com/pattern.png)",
      "order": 0
    }
  ]
}
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

Staged presentation example:

```json
{
  "presentationMode": "staged",
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice",
      "text": "Which function creates a sequence of numbers that a for loop can use?",
      "order": 0,
      "responseTimeLimitMs": 30000,
      "options": [
        { "id": "q1a", "text": "print()?", "isCorrect": false },
        { "id": "q1b", "text": "range()?", "isCorrect": true },
        { "id": "q1c", "text": "input()?", "isCorrect": false },
        { "id": "q1d", "text": "len()?", "isCorrect": false }
      ]
    }
  ]
}
```

Field guidance:

- `questions` is the main launch payload
- `presentationMode` may be `standard` or `staged`; omit it for standard behavior
- each question should have a stable `id`
- `type` should match the activity's supported question types such as `free-response` or `multiple-choice`
- `order` should be explicit and zero-based
- `responseTimeLimitMs` should be provided when timed launch behavior matters
- multiple-choice questions should carry an `options` array
- `text` and `options[].text` support Markdown for emphasis, lists, links, inline code, fenced code blocks, tables, and images
- Markdown images may use `http:`, `https:`, or non-SVG base64 image MIME `data:` URLs such as `data:image/png;base64,...`; SVG data URLs, non-base64 data URLs, and unsafe URL schemes such as `javascript:` or `file:` are not supported
- a resonance MCQ with zero correct options is poll mode and remains single-select; with one correct option it behaves as single-select; with multiple correct options it behaves as multi-select and requires the full correct set
- with `presentationMode: "staged"`, Resonance presents the question set one question at a time; multiple-choice questions show stem-only first, then start their response timer when the teacher reveals choices
- in solo/self-paced Resonance launches with no active run, `presentationMode: "staged"` does not hide choices; students still see and answer the full question set
- when SyncDeck adds `autoActivateAllQuestions: true` to a Resonance launch with `presentationMode: "staged"`, the host starts the staged sequence at the first question; for a multiple-choice first question this shows the stem only and waits for the instructor to reveal choices

### Child embedded launch state

Resonance persistent and embedded recovery paths may store encrypted question material in `embeddedLaunch.selectedOptions` under fields such as:

- `q` for encoded question payload
- `h` for the associated hash
- `presentationMode` for the set/run presentation mode when a host wants to restore or launch staged behavior

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

## Binary Breach

### Deck launch payload

Binary Breach reads the same option keys used by its permanent-link builder. Omit fields to use the activity defaults.

```html
<section
  data-activity-id="binary-breach"
  data-activity-trigger="slide-enter"
  data-activity-options='{"maxBits":"6","missionLength":"5","challengeTypes":"binary-to-decimal,decimal-to-binary,compare-binary","hintsEnabled":"true","placeValueSupport":"optional"}'
>
```

Field guidance:

- `maxBits` accepts `"4"` through `"8"`
- `missionLength` accepts `"3"` through `"12"`
- `challengeTypes` is a comma-separated list using `binary-to-decimal`, `decimal-to-binary`, `compare-binary`, and `order-binary`
- `hintsEnabled` accepts `"true"` or `"false"`
- `placeValueSupport` accepts `visible`, `optional`, or `hidden`

### Child embedded launch state

Binary Breach reads these values from `embeddedLaunch.selectedOptions` and normalizes them into the live session's mission settings before students receive challenges.

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

## Postboard

### Deck launch payload

Postboard can seed a single moderated note board prompt and approval mode.

```html
<section
  data-activity-id="postboard"
  data-activity-trigger="slide-enter"
  data-activity-options='{"prompt":"What should we add to the board?","autoApprove":"false"}'
>
```

Field guidance:

- `prompt` seeds the board prompt shown to instructors and students
- `autoApprove` accepts `"true"` or `"false"`; omit it to default to manual instructor approval
- students still join through the normal embedded child session entry flow and provide the required display name
- instructor-authored notes are approved immediately; student notes follow the selected approval mode

### Child embedded launch state

Postboard reads `embeddedLaunch.selectedOptions.prompt` and `embeddedLaunch.selectedOptions.autoApprove` when SyncDeck creates the child session. The child session normalizer copies those values into live Postboard session state:

- `prompt` becomes `session.data.prompt.text`
- `autoApprove` becomes `session.data.settings.autoApprove`
- `embeddedLaunch.selectedOptions` remains available for launch/recovery metadata

## MobCode

### Deck launch payload

MobCode can seed starter files for an embedded live coding session.

Example:

```html
<section
  data-activity-id="mobcode"
  data-activity-trigger="slide-enter"
  data-activity-options='{"files":{"main.py":"name = input(\"Name? \")\nprint(f\"Hello, {name}!\")\n","README.md":"Pair on the starter code and explain each change.\n"},"activeFile":"main.py","runnerId":"brython-terminal"}'
>
```

Field guidance:

- `files` is an object map of relative virtual paths to UTF-8 text content
- `activeFile` is optional and should match one of the `files` keys when provided
- `runnerId` is optional; use `brython-terminal` to preselect the Python popup runner for Python-focused launches
- paths are normalized as safe relative virtual paths such as `src/Main.java`; traversal segments such as `../`, empty paths, oversized paths, and reserved JavaScript object segments such as `__proto__`, `constructor`, or `prototype` are rejected and will not load
- MobCode currently keeps up to 250 starter files, truncates individual file content at 1 MB, and stops accepting starter content once the total workspace seed reaches 4 MiB
- omit `files` to start with an empty MobCode workspace

### Child embedded launch state

MobCode reads `embeddedLaunch.selectedOptions.files` and `embeddedLaunch.selectedOptions.activeFile` only when the child session is first created without an existing MobCode file tree. After that, the live session state under `groups.default` is authoritative, so later reloads or reconnects do not overwrite instructor edits with the original starter payload.

MobCode also reads `embeddedLaunch.selectedOptions.runnerId` through the child session API so the instructor and students use the instructor-selected runner. The current supported value is `brython-terminal`; unsupported values are ignored and the activity falls back to the default runner. In the student view, available runner options collapse to the instructor-selected runner so students cannot switch to a different implementation.

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

## Embedded Identity And Location

Deck authors should not provide embedded instance IDs. SyncDeck derives runtime identity from the activity id and the slide's actual Reveal position when the instructor loads or enters the deck.

Examples of generated runtime keys:

- `resonance:2:0`
- `embedded-test:3:0`
- `raffle:3:1`
- `algorithm-demo:3:2`
- `video-sync:4:0`
- `gallery-walk:5:0`

The runtime also stores a separate embedded location such as `{ "h": 3, "v": 1 }`. Student activation should use that location contract rather than any ID authored into the presentation markup. Keep deck markup focused on:

- `data-activity-id`
- `data-activity-trigger`
- `data-activity-options`

When a launch request includes `location`, `h` and `v` must be finite integers and the `instanceKey` must match the generated key for that activity and location, such as `raffle:3:1`. Fractional coordinates and mismatched key/location pairs are rejected before a child session is created.

## Authoring Rules

- Prefer activity-specific payloads that match the child activity's real bootstrap fields.
- Avoid using host-only test metadata in polished deck examples unless you clearly label it as such.
- If an activity's deck launch payload and child `selectedOptions` differ, document both shapes.
- When in doubt, keep the deck payload minimal and let the host normalize it.
