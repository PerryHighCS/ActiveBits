# Slide Extensions

Use this file only when the deck needs specialized behavior beyond the default Reveal structure.

## YouTube Slides

For synchronized video slides, prefer declarative slide metadata rather than hand-writing raw YouTube iframes.

Authoring contract:

- use `data-youtube-*` attributes on the slide
- let the shared runtime create the player shell by default
- add `.youtube-player-slot` only when the layout needs a custom placement

Minimal example:

```html
<section
  data-youtube-video-id="VIDEO_ID"
  data-youtube-start="0"
  data-youtube-autoplay="false"
  data-youtube-student-audio="mute"
>
  <div class="slide-inner">
    <h2>Demo Video</h2>
  </div>
</section>
```

Custom placement:

```html
<section data-youtube-video-id="VIDEO_ID">
  <div class="slide-inner split">
    <div>
      <h2>Demo Video</h2>
      <p>Context and speaker notes.</p>
    </div>
    <div class="youtube-player-slot"></div>
  </div>
</section>
```

Behavior expectations:

- `standalone` keeps local controls enabled
- `student` follows synchronized playback policy
- `instructor` is the authoritative playback source

## Student-Controlled Vertical Stacks

Use Reveal vertical stacks when students should explore within a bounded section after the instructor reaches it.

Authoring contract:

- use a parent horizontal `<section>` with child `<section>` slides
- declare stack behavior on the parent section
- keep the stack bounded; it should not become unrestricted free navigation

Example:

```html
<section
  data-student-stack="true"
  data-student-local-control="true"
  data-youtube-student-audio="mute"
>
  <section>
    <div class="slide-inner">
      <h2>Explore This Topic</h2>
      <p>Students can move within this stack after the instructor reaches it.</p>
    </div>
  </section>

  <section data-youtube-video-id="VIDEO_ID">
    <div class="slide-inner">
      <h2>Watch and Explore</h2>
    </div>
  </section>

  <section>
    <div class="slide-inner">
      <h2>Reflection</h2>
    </div>
  </section>
</section>
```

Behavior expectations:

- students only gain local control within the released stack
- instructor and host controls remain authoritative over release policy
- video slides inside an enabled stack may allow local student playback if configured
