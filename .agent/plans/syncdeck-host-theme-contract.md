# SyncDeck Host Theme Contract Plan

## Status: Proposed

This plan defines a theming contract between SyncDeck-authored activity payloads and the
host renderer so instructor-launched or embedded activities can inherit deck colors and
typography instead of falling back to the host's default white UI.

---

## Problem Statement

Today the host renderer owns the embedded activity chrome and defaults to its built-in UI
theme. That means a deck can control slide visuals while the embedded activity shell
still appears with unrelated colors, surfaces, and typography.

We want a contract where:

1. The deck remains the source of presentation styling intent.
2. The host remains the source of rendering and CSS application.
3. Activities still render safely when no theme tokens are supplied.

This should work without hard-coding one course style into shared host CSS.

---

## Goals

- Let deck-authored activity payloads provide theme tokens for host-rendered activity UI.
- Let the host map those tokens into CSS variables or equivalent theme state.
- Preserve a host fallback theme when tokens are missing, partial, or invalid.
- Support both embedded activity launches and future standalone launcher/deck-triggered
  flows that want the same visual contract.
- Keep the contract generic and activity-agnostic in shared host code.

## Non-Goals

- Do not make activities directly own or inject host CSS rules.
- Do not require every activity payload to carry a fully expanded design system object.
- Do not couple host styling to a specific course, deck, or presentation brand.
- Do not block activity launch if theme tokens are missing or malformed.

---

## Recommended Direction

Use a normalized token contract that the deck may supply and the host may partially apply.

Recommended token families:

```ts
interface ActivityHostThemeTokens {
  brand?: {
    primary?: string
    accent?: string
    danger?: string
  }
  surface?: {
    background?: string
    card?: string
    border?: string
  }
  text?: {
    heading?: string
    body?: string
    muted?: string
  }
  typography?: {
    headingFont?: string
    bodyFont?: string
    monoFont?: string
  }
  radius?: {
    card?: string
    control?: string
  }
  shadow?: {
    strength?: string
  }
}
```

Host-owned fallback values should always exist for every supported token.

---

## Two Viable Payload Patterns

### Option A: Per-Activity Theme

Each activity payload carries its own theme object:

```ts
{
  type: 'activity',
  activityId: 'resonance',
  ui: {
    theme: { ...tokens }
  }
}
```

Pros:

- Simple to reason about.
- No theme registry lookup in the host.
- Easy for exported payload docs to show complete examples.

Cons:

- Repeats identical tokens across many activities in the same deck.
- More payload churn when a deck-wide theme changes.

### Option B: Per-Deck Global Theme

The deck emits a shared theme once, and activities reference it:

```ts
{
  type: 'deckTheme',
  themeId: 'default',
  theme: { ...tokens }
}

{
  type: 'activity',
  activityId: 'resonance',
  ui: {
    themeId: 'default'
  }
}
```

Pros:

- Better for large decks with many embedded activities.
- Keeps activity payloads smaller and more stable.
- Gives the host a natural cache/update point for later live theme refresh.

Cons:

- Requires lifecycle and lookup rules.
- More moving parts for the first implementation.

### Recommendation

Start with Option B as the primary contract: the presentation startup flow emits a single
deck-level theme object, and activity payloads inherit that theme by default.

Then add per-activity inline overrides on top of the resolved deck theme when a specific
activity needs local adjustments.

That means:

- the presentation startup/bootstrap path becomes the natural place to send the deck theme
- host theme normalization should consume a resolved deck theme plus optional activity
  overrides
- activity payload parsing can stay small by default and only carry `ui.theme` when an
  override is actually needed
- precedence should be explicit: activity override tokens win over deck-level tokens, and
  both fall back to the host default theme

---

## Recommended Startup Flow

At deck startup, the presentation can call its existing JavaScript bootstrap function and
pass a design/theme object once for the whole deck.

Conceptually:

```ts
syncDeckHost.start({
  deckTheme: {
    themeId: 'deck-default',
    theme: { ...tokens }
  }
})
```

Then each activity request can either:

1. inherit the current deck theme implicitly, or
2. provide `ui.theme` overrides for local adjustments

Conceptually:

```ts
{
  type: 'activity',
  activityId: 'resonance',
  ui: {
    theme: {
      brand: {
        accent: '#7c3aed'
      }
    }
  }
}
```

The host resolves theme application as:

```text
host fallback theme
  <- merged with deck theme
  <- merged with per-activity override theme
```

This keeps presentation ownership at startup, keeps payloads smaller, and still gives
authors an escape hatch when one embedded activity needs a slightly different shell.

---

## Host Rendering Contract

The host should:

1. Parse theme tokens from the resolved activity request.
2. Validate/sanitize supported token values.
3. Merge supplied tokens over the host fallback theme.
4. Map the merged theme to host CSS variables.
5. Render the activity shell using only host-owned CSS variables.

Suggested CSS variable surface:

```css
--ab-theme-brand-primary
--ab-theme-brand-accent
--ab-theme-brand-danger
--ab-theme-surface-background
--ab-theme-surface-card
--ab-theme-surface-border
--ab-theme-text-heading
--ab-theme-text-body
--ab-theme-text-muted
--ab-theme-font-heading
--ab-theme-font-body
--ab-theme-font-mono
--ab-theme-radius-card
--ab-theme-radius-control
--ab-theme-shadow-strength
```

The host can then derive any additional local presentation details from those variables.

---

## Validation Rules

- Unknown token groups/keys should be ignored.
- Missing values should fall back to host defaults.
- Color tokens should accept only supported CSS color formats.
- Font tokens should be sanitized to a safe allowlist or normalized font-family string.
- Radius/shadow tokens should be limited to safe CSS value formats.
- Invalid values should not block rendering; they should be dropped and optionally logged.

Server or client logging should record malformed theme payloads without logging unrelated
session secrets or sensitive data.

---

## Compatibility Strategy

- Theme tokens are optional.
- Existing decks and activity payloads must continue rendering with the current host theme.
- The host should tolerate partial themes so a deck can override only colors or only fonts.
- Deck theme is optional; when omitted, the host fallback theme remains active.
- Inline `ui.theme` should be treated as a per-activity override layer, not a replacement
  contract.
- Precedence should be documented explicitly:
  activity override theme > deck theme > host fallback theme.

---

## Candidate Integration Points

- SyncDeck presentation startup/bootstrap path where deck JavaScript initializes the host
- SyncDeck shared payload definitions and payload normalization for per-activity overrides
- Host-side embedded activity request parsing
- Host renderer shell / embedded overlay styles
- Shared activity payload docs in:
  `skills/syncdeck/references/ACTIVITY_PAYLOADS.md`

If the payload format changes, update the shared SyncDeck skill docs in the same branch.

---

## Open Questions

- Should color/font tokens be validated on the deck side, host side, or both?
- Should host fallback typography remain global, or can a deck override fonts only when the
  font is already available in the host environment?
- Should theme changes apply only on initial launch, or can the deck update them while the
  activity is active?
- Do standalone launcher flows need the same `ui.theme` contract immediately, or only
  embedded SyncDeck activity rendering?
- Should host shell chrome and activity iframe/container both inherit the same variables,
  or should some surfaces stay host-owned regardless of deck theme?

---

## Implementation Checklist

- [ ] Audit the current host-rendered activity shell and identify where default white UI
      values are defined.
- [ ] Identify the current presentation startup/bootstrap hook and the safest place to send
      a deck-level theme object once per presentation load.
- [ ] Identify the current embedded activity payload schema and the safest place to attach
      optional `ui.theme` override tokens.
- [ ] Define the normalized token type and fallback host theme object in shared code.
- [ ] Define the theme merge order:
      host fallback -> deck theme -> per-activity override theme.
- [ ] Add token validation/sanitization helpers for supported colors, fonts, radius, and
      shadow values.
- [ ] Persist the resolved deck theme in host state so later activity launches can inherit
      it without repeating the full theme payload.
- [ ] Map resolved theme tokens to host CSS variables in the shared renderer shell.
- [ ] Update host UI styles to consume the CSS variable contract instead of hard-coded
      defaults where appropriate.
- [ ] Add tests for:
      - deck theme bootstrap application
      - missing theme tokens
      - partial theme tokens
      - invalid tokens falling back cleanly
      - per-activity override application
      - route/reconnect/reload behavior preserving theme
- [ ] Update payload docs in
      `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` if the launch payload format
      changes.
- [ ] Update `.agent/knowledge/data-contracts.md` with the final contract and fallback
      behavior once implementation starts.
