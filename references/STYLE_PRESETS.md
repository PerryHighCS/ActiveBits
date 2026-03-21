# Style Presets

Use this file when the user wants help choosing or varying a visual direction.

## Required Base CSS

Apply these rules in every custom Reveal theme:

```css
body,
.reveal-viewport {
  background: var(--bg);
  background-color: var(--bg);
}

.reveal {
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
}

.reveal h1,
.reveal h2,
.reveal h3,
.reveal h4,
.reveal h5,
.reveal h6 {
  color: var(--text);
  font-family: var(--font-display);
  font-weight: 700;
  line-height: 1.1;
  text-transform: none;
  margin: 0;
}

.reveal p,
.reveal li,
.reveal blockquote {
  color: var(--text-muted);
  font-family: var(--font-body);
}

:root {
  --bg: #0a0f1c;
  --text: #ffffff;
  --text-muted: rgba(255, 255, 255, 0.68);
  --accent: #00ffcc;

  --font-display: 'Sora', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  --title: 100px;
  --h2: 56px;
  --h3: 36px;
  --body: 25px;
  --small: 19px;
  --code: 21px;

  --pad: 72px;
  --gap: 26px;
  --gap-sm: 13px;
  --gap-lg: 52px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.reveal .slides > section {
  height: 100%;
  padding: 0 !important;
  box-sizing: border-box;
  text-align: left;
}

.slide-inner {
  width: 100%;
  height: 100%;
  padding: var(--pad);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--gap);
  overflow: hidden;
  position: relative;
}
```

Important:

- Do not put `position: relative` on `.reveal .slides > section`
- Keep primary sizing values in `px`
- Reset Reveal defaults explicitly instead of assuming a bundled theme file is present

## Visual Directions

### Editorial Modernist

- high-contrast type
- strong grid
- restrained accent color
- oversized headlines and quiet body copy

Good for:

- academic talks
- product strategy
- thesis-style decks

### Warm Workshop

- paper or studio tones
- rounded cards
- tactile borders
- classroom-friendly contrast without feeling corporate

Good for:

- teacher-facing decks
- collaborative lessons
- reflection prompts

### Technical Signal

- dark instrumentation palette
- mono accents and grid overlays
- diagram-first slides
- deliberate use of status colors

Good for:

- systems talks
- protocol walkthroughs
- debugging or architecture decks

### Bright Campaign

- saturated accent pair
- bold type and cinematic spacing
- larger motion moments on section transitions

Good for:

- keynote openings
- recruitment decks
- launch presentations

## Composition Heuristics

- One hero idea per slide beats three medium ideas.
- Pair dense content with a simple layout, not a busier one.
- If a slide uses a textured background, simplify the type palette.
- Use motion to pace explanation, not to decorate every element.
