---
name: syncdeck
description: Build Reveal.js slide decks and SyncDeck-compatible presentations. Use when the user wants to create a presentation, convert PPT/PPTX content to web slides, add storyboard or iframe-sync behavior, or embed interactive activities inside a SyncDeck-hosted Reveal deck.
---

# SyncDeck Skill

Create production-quality Reveal.js presentations that can run standalone or inside a SyncDeck iframe host.

Read this file first. Then load only the references you need:

- `references/AVAILABLE_ACTIVITIES.md` to see which embedded activities are currently available and what each one is good for
- `references/STYLE_PRESETS.md` for visual directions and required base CSS
- `references/EXTENSIONS.md` for optional deck features such as YouTube slides and student-controlled stacks
- `references/EMBEDDED_ACTIVITIES.md` when the deck should launch or host embedded activities
- `references/IFRAME_SYNC_PROTOCOL.md` when wiring host-to-iframe messaging or debugging sync behavior

## Attribution And License

- Attribution: `NOTICE.md`
- License: `LICENSE.md`

## Core Rules

1. Use Reveal.js for navigation, transitions, fragments, progress, and slide numbers. Do not invent a custom slide framework.
2. Keep decks browser-native: semantic HTML, CSS, and lightweight JavaScript.
3. Prefer intentional, distinctive visual systems over generic templates.
4. Treat each slide as a fixed canvas composition, not a fluid article page.
5. Split overflowing content across slides instead of shrinking it until it barely fits.

## Reveal Canvas Rules

Reveal renders slides on a fixed canvas, then scales that canvas to the viewport. Design for the canvas, not the live viewport.

Required implications:

- Use `px` for font sizes, spacing, and layout tokens.
- Do not use `clamp()`, `vw`, or `em` for primary sizing tokens.
- Do not add font-size media queries just to handle smaller screens.
- Size slides for a 1600x900 canvas unless the deck has a deliberate alternative.

## Required Deck Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <link rel="stylesheet" href="../../runtime/syncdeck-reveal/dist/syncdeck-reveal.css">
  <style>
    /* Add custom theme CSS here. See references/STYLE_PRESETS.md */
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section>
        <div class="slide-inner">
          <h1>Title</h1>
          <p>Subtitle</p>
        </div>
      </section>
    </div>
  </div>

  <div id="storyboard" class="storyboard" aria-hidden="true">
    <div id="storyboard-track" class="storyboard-track"></div>
  </div>

  <script src="../../runtime/syncdeck-reveal/dist/syncdeck-reveal.js"></script>
  <script>
    initSyncDeckReveal({
      deckId: 'my-deck-name',
      iframeSyncOverrides: {
        // Optional per-deck iframeSync overrides
      },
      revealOverrides: {
        // Optional per-deck Reveal overrides
      },
      chalkboardOverrides: {
        // Optional chalkboard overrides. Do not set storage.
      },
      storyboard: {
        // Optional: storyboardId / trackId / toggleKey
      },
      afterInit: function (Reveal) {
        // Optional deck-specific hooks
      },
    });
  </script>
</body>
</html>
```

Use a relative path from the deck's published location. In this repo's common
`/<course>/<unit>/deck.html` layout, that means
`../../runtime/syncdeck-reveal/dist/...`.

The bundle provides `Reveal`, `RevealNotes`, `RevealChalkboard`, `RevealIframeSync`, `initRevealStoryboard`, and `initSyncDeckReveal`. Do not add CDN links for Reveal.js or its plugins when authoring SyncDeck decks.

## Required Layout Conventions

- Put padding, centering, and internal positioning on a child wrapper like `.slide-inner`, not on the slide `<section>` itself.
- Keep each top-level slide visually complete at 16:9.
- Use fragments for progressive reveal when a presenter needs pacing.
- Use semantic controls and accessible names for any custom buttons or toggles.

## Storyboard Contract

Include storyboard markup:

```html
<div id="storyboard" class="storyboard" aria-hidden="true">
  <div id="storyboard-track" class="storyboard-track"></div>
</div>
```

Place it as a sibling of `.reveal`, not inside `.slides`.

Storyboard expectations:

- hidden by default
- keyboard-toggleable
- click-to-navigate
- active-slide highlighting
- 16:9 thumbnails that do not cover the deck when opened

## Iframe Sync Contract

When a parent host should control the deck, initialize with `initSyncDeckReveal(...)` and pass any sync-specific settings through `iframeSyncOverrides`:

```html
<script src="../../runtime/syncdeck-reveal/dist/syncdeck-reveal.js"></script>
<script>
initSyncDeckReveal({
  deckId: 'my-unique-deck-id',
  iframeSyncOverrides: {
    // IMPORTANT:
    // - In development you may be tempted to use hostOrigin: '*' and allowedOrigins: ['*'].
    //   That disables origin validation and MUST NOT be used in production decks.
    // - In production, always restrict to the exact host origin(s) that are allowed to
    //   control this deck via postMessage.
    hostOrigin: 'https://your-host.example',
    allowedOrigins: [
      'https://your-host.example',
    ],
  },
});
</script>
```

Non-negotiable checks:

- `deckId` must be unique and must match what the host targets
- use `initSyncDeckReveal(...)` rather than calling `Reveal.initialize(...)` directly
- the host, not the deck markup, should decide runtime role changes

Role lifecycle:

- decks always initialize in `standalone` mode
- the host must send `setRole` to promote to `instructor` or `student`
- do not rely on a `role` config field to set the initial role

Overview routing:

- Reveal's built-in grid overview is intentionally routed to the storyboard strip in synced student views
- `overview: true/false` inside synced `setState` traffic becomes `reveal-storyboard-set` DOM events rather than a native Reveal overview state

Chalkboard persistence:

- do not set `chalkboard.storage`
- the host is the source of truth for drawing state and local storage would diverge after reloads

For command details and message shapes, read `references/IFRAME_SYNC_PROTOCOL.md`.

## Authoring Guidance

- Prefer local relative asset paths for shared runtime files.
- Keep visual tokens in CSS custom properties, but keep the token values in `px`.
- When using a split layout, balance text density against media weight instead of letting one side dominate.
- If a slide needs more than one dense paragraph plus supporting UI, it probably needs to be multiple slides.

## Embedded Activities

If the deck should trigger activity launches or act as a host shell for interactive overlays, read `references/EMBEDDED_ACTIVITIES.md` before writing markup. The short version is:

- use declarative slide metadata for activity launch intent
- let the host own session lifecycle and orchestration
- keep embedded activity behavior isolated from shared slide plumbing

## Delivery Standard

A finished deck should be:

- readable on desktop and mobile viewports through Reveal scaling
- accessible in its controls and structural markup
- self-consistent in typography and motion
- free of obvious overflow, clipping, and broken navigation states
