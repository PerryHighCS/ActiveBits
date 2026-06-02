# Issue 186: Resonance Markdown Formatting

## Issue

GitHub issue: https://github.com/PerryHighCS/ActiveBits/issues/186

Resonance question stems and multiple-choice answer choices should support formatting. Markdown is the preferred authoring model because it can cover common classroom needs such as code blocks, inline code, links, emphasis, lists, tables, and images.

## Product Direction

Use Markdown as the formatting syntax for:

- free-response question stems
- multiple-choice question stems
- multiple-choice answer choice text

Plain text should continue to work exactly as it does today. Existing question payloads use `text` string fields; this feature should preserve that contract and interpret those strings as Markdown at render time rather than introducing parallel `markdown` fields.

## Desired Rendering Behavior

- Code blocks should render with a classroom-friendly style: readable monospace text, preserved whitespace, horizontal scrolling when needed, and enough contrast in light/dark themes.
- Inline code should be visually distinct without disrupting surrounding text.
- GitHub-flavored Markdown tables should render with responsive horizontal overflow so data-heavy prompts remain usable on small screens.
- Images should render inside the question/choice bounds with responsive sizing, useful alt text when provided, and no layout overflow.
- Links should be safe and should open in a way that does not let authored Markdown take over the ActiveBits page.
- Markdown in answer choices should not interfere with selecting radio/checkbox controls.
- Stem-only staged MCQs should render the formatted stem while still hiding choices until reveal.

## Security and Compatibility Constraints

- Do not render raw HTML from Markdown unless there is a clear sanitizer strategy and tests.
- Prefer a Markdown renderer that escapes or ignores raw HTML by default.
- Allow Markdown image URLs with `http:`, `https:`, or image-only `data:` schemes. Block other schemes such as `javascript:` and `file:`. Treat SVG data URLs as out of scope for the first pass unless implementation includes a specific sanitizer and tests.
- Increase existing server validation limits deliberately for Markdown and image-heavy prompts, especially where data URLs are allowed. Keep limits finite, documented, and covered by validation tests.
- Keep all formatted content in the existing Resonance activity boundary; shared app code should not become Resonance-specific.
- Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` so deck authors know Resonance `text` and `options[].text` fields may contain Markdown, including examples for code blocks, tables, and images.

## Resolved Decisions

- Image URLs: allow `http:`, `https:`, and image MIME `data:` URLs; block other schemes. Defer SVG data URLs unless sanitized deliberately.
- Code blocks: implement high-quality pre/code styling in the first pass without syntax highlighting. Preserve language metadata/classes so syntax highlighting can be added later without changing authoring syntax.
- Tables: support GitHub-flavored Markdown tables in the first pass because they are useful for data-oriented CS questions.
- Builder preview: first pass should provide Markdown-friendly authoring controls with rendered display in question surfaces. A full live preview is not required unless it is straightforward to add without expanding scope.
- Validation limits: increase the current 2,000-character question stem limit and 500-character option limit to support Markdown and data URL image use while retaining explicit caps.

## Implementation Plan

- [ ] Choose the Markdown rendering stack for the activities workspace. Prefer a React renderer such as `react-markdown` with `remark-gfm`; confirm whether an explicit sanitizer plugin is needed when raw HTML is disabled.
- [ ] Add a small Resonance-owned formatted-text component, for example `activities/resonance/client/components/FormattedMarkdown.tsx`, that renders Markdown with constrained styling for paragraphs, lists, code, tables, links, and images.
- [ ] Implement URL-scheme validation for Markdown links/images: allow safe links, allow image `http:`, `https:`, and image MIME `data:` URLs, and block unsafe schemes.
- [ ] Replace direct question stem text rendering with the formatted component in student, manager, shared response, and report-facing Resonance views.
- [ ] Replace direct MCQ option text rendering with the formatted component in student MCQ inputs and instructor MCQ response/table views while preserving accessible input labels.
- [ ] Update `QuestionBuilder` authoring UI to make Markdown authoring comfortable: use multiline text areas for options and expose concise helper copy. Live preview can be deferred unless it is simple and ergonomic.
- [ ] Increase validated content length caps for stems and options to support Markdown and data URLs, with clear constants and tests for accepted and rejected lengths.
- [ ] Ensure imported, encrypted, persistent-link, solo, and SyncDeck embedded question payloads continue using the same `text` fields with no schema break.
- [ ] Add tests for Markdown rendering in stems and choices, including inline code, fenced code blocks, GFM tables, links, image syntax, URL filtering, and raw HTML escaping/ignoring.
- [ ] Add accessibility tests or assertions that formatted answer choices remain selectable and keep useful accessible names.
- [ ] Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` with embedded Resonance Markdown payload examples for stems and answer choices.
- [ ] Update `.agent/knowledge/data-contracts.md` and `.agent/knowledge/security-notes.md` with the Markdown contract and sanitization decision.
- [ ] Run focused Resonance tests, activities typecheck, scoped lint, and the Resonance scoped test suite; broaden to full `npm test` if dependency or shared rendering changes affect cross-workspace behavior.

## Remaining Open Questions

None identified yet. Revisit during implementation if renderer behavior, sanitizer behavior, or dependency constraints force a tradeoff.

## Initial Verification Notes

No implementation yet. Branch and plan created from `main` on 2026-06-02.
