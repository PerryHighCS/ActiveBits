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
  <link rel="stylesheet" href="https://unpkg.com/reveal.js@5/dist/reveal.css">
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

  <script src="https://unpkg.com/reveal.js@5/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      hashOneBasedIndex: true,
      transition: 'fade',
      transitionSpeed: 'fast',
      backgroundTransition: 'none',
      center: false,
      controls: true,
      controlsLayout: 'edges',
      progress: true,
      slideNumber: 'c/t',
      keyboard: true,
      touch: true,
      fragments: true,
      width: 1600,
      height: 900,
      margin: 0.04,
      minScale: 0.2,
      maxScale: 2.5,
    });
  </script>
</body>
</html>
```

## Required Layout Conventions

- Put padding, centering, and internal positioning on a child wrapper like `.slide-inner`, not on the slide `<section>` itself.
- Keep each top-level slide visually complete at 16:9.
- Use fragments for progressive reveal when a presenter needs pacing.
- Use semantic controls and accessible names for any custom buttons or toggles.

## Default Add-Ons

Unless the user asks otherwise, deck builds should include:

1. A toggleable storyboard strip driven by `vendor/SyncDeck-Reveal/js/reveal-storyboard.js`
2. Iframe sync wiring driven by `vendor/SyncDeck-Reveal/js/reveal-iframe-sync.js` when the deck will be hosted in SyncDeck or another parent shell

## Storyboard Contract

Include storyboard markup:

```html
<div id="storyboard" class="storyboard" aria-hidden="true">
  <div id="storyboard-track" class="storyboard-track"></div>
</div>
```

Include runtime wiring after `Reveal.initialize(...)`:

```html
<script src="https://unpkg.com/reveal.js@5/dist/reveal.js"></script>
<script src="../vendor/SyncDeck-Reveal/js/reveal-storyboard.js"></script>
<script>
if (window.initRevealStoryboard) {
  window.initRevealStoryboard({
    reveal: Reveal,
    storyboardId: 'storyboard',
    trackId: 'storyboard-track',
    toggleKey: 'm',
  });
}
</script>
```

Storyboard expectations:

- hidden by default
- keyboard-toggleable
- click-to-navigate
- active-slide highlighting
- 16:9 thumbnails that do not cover the deck when opened

## Iframe Sync Contract

When a parent host should control the deck, load the iframe sync runtime and register the plugin:

```html
<script src="https://unpkg.com/reveal.js@5/dist/reveal.js"></script>
<script src="../vendor/SyncDeck-Reveal/js/reveal-iframe-sync.js"></script>
<script>
Reveal.initialize({
  plugins: [RevealIframeSync].filter(Boolean),
  iframeSync: {
    deckId: 'my-unique-deck-id',
    // IMPORTANT:
    // - In development you may be tempted to use hostOrigin: '*' and allowedOrigins: ['*'].
    //   That disables origin validation and MUST NOT be used in production decks.
    // - In production, always restrict to the exact host origin(s) that are allowed to
    //   control this deck via postMessage.
    hostOrigin: '*',
    allowedOrigins: [
      '*',
    ],
  },
});
</script>
```

Non-negotiable checks:

- `RevealIframeSync` must be listed in `plugins`
- `deckId` must be unique and must match what the host targets
- the host, not the deck markup, should decide runtime role changes

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
