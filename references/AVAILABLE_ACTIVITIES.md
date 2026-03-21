# Available Activities

Use this file when choosing which activities a SyncDeck presentation can embed.

This is a deck-authoring catalog, not an exhaustive feature spec. It is meant to answer:

- what activities currently exist in this repo
- which ones are realistic embedded candidates
- what kind of classroom moment each activity fits best

For concrete launch payloads, read `ACTIVITY_PAYLOADS.md`.

## Strong Embedded Candidates

### Resonance

- id: `resonance`
- best for: live check-ins, free-response prompts, polls, and quick graded multiple-choice questions
- classroom shape: pause the deck, collect responses, review/share selected student work, then resume
- notes:
  uses question-set payloads rather than a single title or seed value

### Video Sync

- id: `video-sync`
- best for: synchronized YouTube playback with instructor-led pacing
- classroom shape: watch together, pause for discussion, keep playback aligned across students
- notes:
  the core bootstrap field is `sourceUrl`

### Algorithm Demo

- id: `algorithm-demo`
- best for: guided algorithm visualizations and short interactive CS concept moments
- classroom shape: branch into a visualization, then return to the main deck
- notes:
  useful when the deck wants to pre-select a specific algorithm

### Gallery Walk

- id: `gallery-walk`
- best for: critique, peer feedback, and later report/download flows
- classroom shape: launch a structured feedback activity, then aggregate or export results
- notes:
  has an activity-owned report endpoint, which makes it stronger for sessions that need post-activity reporting

### Raffle

- id: `raffle`
- best for: lightweight choice prompts, randomized turns, or quick classroom selection moments
- classroom shape: simple embedded interruption with minimal configuration
- notes:
  good when the deck needs a low-friction interactive beat rather than a deep workflow

## Utility / Contract-Test Activity

### Embedded Test

- id: `embedded-test`
- best for: host-contract smoke testing and SyncDeck integration debugging
- classroom shape: development-only or QA validation of launch, dedupe, and overlay behavior
- notes:
  not a polished classroom activity; use when validating the embedding seam itself

## Activities Present In The Repo But Not Primary SyncDeck Targets

These activities exist in ActiveBits, but they are not the main examples or strongest default embedded choices for SyncDeck-authored decks right now:

- `java-format-practice`
- `java-string-practice`
- `python-list-practice`
- `traveling-salesman`
- `www-sim`

These may still be embeddable in the future, but deck authors should not assume a polished embedded contract without checking the activity implementation and adding payload documentation first.

## Quick Selection Guide

Choose:

- `resonance` for “pause and collect thinking”
- `video-sync` for “watch together”
- `algorithm-demo` for “show a concept in motion”
- `gallery-walk` for “structured critique or feedback artifacts”
- `raffle` for “quick lightweight interaction”
- `embedded-test` for “verify the embedding contract itself”

## Maintenance Rule

When a new activity becomes a real SyncDeck embedding candidate:

- add it here with a short purpose description
- add or update its launch payload format in `ACTIVITY_PAYLOADS.md`
- update `EMBEDDED_ACTIVITIES.md` if the host contract needs new generic guidance
