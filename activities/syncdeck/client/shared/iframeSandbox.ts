export const SYNCDECK_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms'

// Embedded activities can include a nested media provider (for example, Video Sync's
// YouTube player). Delegate autoplay from the SyncDeck host so a synchronized,
// muted playback command is not blocked at the outer iframe boundary.
export const SYNCDECK_EMBEDDED_ACTIVITY_IFRAME_ALLOW = 'autoplay; fullscreen'

// SECURITY: `allow-popups-to-escape-sandbox` intentionally permits new tabs/windows
// opened by the presentation iframe to run without the iframe sandbox. This should
// only be used for instructor-configured presentation content where unsandboxed
// popups are explicitly allowed and the trust tradeoff is understood. Do not reuse
// this value for more general embedded/internal iframes unless that behavior is required.
export const SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms'
