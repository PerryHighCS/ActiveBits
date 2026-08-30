# Shared Activity Runtime Threat Model

## Status and Scope

This is the implementation contract extracted from the completed activity audit on
2026-08-29. It governs the new shared runtime only; it does not claim to remediate
the separately tracked raw shared-session disclosure advisory.

The runtime makes temporary-session creators managers automatically without accounts
or prompts. It does not treat a session ID, URL, display name, request participant ID,
or requested WebSocket role as authority.

## Security Boundary

| Value | May do | Must not do |
| --- | --- | --- |
| Session ID / public route address | Locate a session or declared public projection | Authorize a mutation, private read, socket subscription, or manager state |
| Browser capability cookie | Resolve one server-issued principal in its scoped session | Be exposed to activity code, URLs, logs, or browser storage |
| `ActivityPrincipal` | Authorize a declared route, socket, command, or projection | Carry a raw token or grant activity-specific authority implicitly |
| Activity state | Supply domain data to an activity-owned projection | Be serialized wholesale by shared routes or broadcasts |
| Activity-defined scoped grant | Identify an authenticated subject/resource relationship | Let shared runtime infer the activity's domain rules |

The platform authenticates and admits; an activity validates its domain command and
builds its own output projection. Authentication never makes request payload fields
or activity state safe by itself.

## Version 1 Principal Contract

The shared runtime resolves a principal before an activity HTTP handler runs or a
WebSocket is retained. Activities receive no cookie value, passcode, handoff token,
or client-selected role.

```ts
type ActivityPrincipal =
  | { version: 1; kind: 'public'; sessionId: string }
  | {
      version: 1
      kind: 'participant'
      sessionId: string
      subjectId: string
      displayName: string | null
    }
  | {
      version: 1
      kind: 'manager'
      sessionId: string
      capabilityId: string
      source: 'temporary' | 'persistent' | 'embedded' | 'learn' | 'substitute'
    }
  | {
      version: 1
      kind: 'scoped'
      sessionId: string
      subjectId: string
      grant: { type: string; resourceId: string }
    }
  | {
      version: 1
      kind: 'service'
      sessionId: string
      integration: 'learn'
    }
```

`grant.type` and `grant.resourceId` are opaque to shared code. Gallery Walk may use
them for reviewer and reviewee grants; WWW Sim may use them for a simulated-host
subject. Activities own grant lifecycle, meaning, and domain checks. Subject IDs stay
immutable; mutable public addresses, such as a simulated hostname or QR target, are
never identities.

`public` is available only where an activity explicitly declares a public projection.
It authorizes read-only public routes and sockets, never a mutation. An activity with
no declaration rejects anonymous admission.

## Capability Rules

- A capability is an opaque, high-entropy random value. The server stores only its
  hash plus capability ID, session ID, principal kind, issuance source, expiry,
  revocation state, and any parent-child linkage needed for embedded launches.
- Browser capabilities are issued only in `HttpOnly`, `SameSite` cookies. `Secure`
  is enabled for HTTPS production traffic and testable local development follows the
  existing live-connection policy.
- The runtime resolves a cookie into a principal, then discards the raw token before
  invoking activity code or structured logging. Tokens and passcodes are never query
  values, path values, WebSocket query parameters, localStorage, sessionStorage, or
  IndexedDB values.
- Waiting-room acceptance issues a participant capability. Request input may identify
  an entry request, but cannot select the resulting participant identity. Consumption
  must emit exactly one non-empty httpOnly cookie.
- Creation issues the creator's temporary-manager capability in the same response.
  Persistent teacher recovery, authenticated parent embedding, Learn integration, and
  substitute links are adapters that resolve to the same manager principal. A
  credentialless embedded child still receives parent-derived manager authority.
- A signed, single-use browser handoff is permitted only as a bounded exchange into an
  httpOnly capability; it is consumed before the final manager URL is displayed and
  never becomes an activity credential.
- Capabilities expire with the session or an earlier bounded lifetime, are revoked on
  session end, and have explicit rotation semantics. The exact cookie record layout
  (per-session cookie versus bounded collection) remains an implementation decision;
  either form must preserve session scoping, bounded size, and independent revocation.

## Projection Contract

Every runtime response and outbound message declares one audience:

```ts
type ProjectionAudience = 'public' | 'participant' | 'manager' | 'scoped'

interface ActivityProjectionContext {
  principal: ActivityPrincipal
  audience: ProjectionAudience
}
```

Activities provide projection functions for the audiences they support. The runtime
does not serialize a raw `SessionRecord`, and a public projection cannot inherit a
manager projection by omission. Participant and scoped projections are subject-specific;
they must not include peer private state unless that visibility is explicitly part of
the declared activity behavior. Private HTTP responses use `Cache-Control: no-store`.

## HTTP Admission

Route groups declare a required principal kind. Shared wrappers resolve the session,
confirm its activity type, authenticate the principal, and only then call activity
domain validation and handlers. This ordering prevents handlers from using a forged
ID or a wrong-session capability as an authorization hint.

The minimum route groups are `public`, `participant`, `manager`, `scoped`, and
`service`. Specialized activity routes declare their scoped-grant predicate after the
runtime has resolved the scoped principal. Manager report and export routes use the
same manager resolution as manager mutation routes.

## WebSocket Admission and Delivery

- Socket query fields can describe a desired endpoint but never select authority.
- The runtime resolves the principal before subscribing, retaining, replaying an
  initial snapshot, or publishing presence.
- A connection carries only the resolved principal and its session/activity identity.
  Duplicate-socket and disconnect accounting is keyed by that server-side principal.
- Outbound delivery declares an audience and uses the identical audience filter for
  local sockets and cross-instance pub/sub fanout.
- Participant-targeted delivery is keyed by authenticated `subjectId`; it never
  matches a browser-supplied ID. Scoped delivery applies the authenticated grant.
- Authentication failure is terminal and versioned. The client receives one defined
  recovery decision rather than retrying a rejected socket indefinitely.

## Required Adapters

| Entry mode | Resulting principal | Constraint |
| --- | --- | --- |
| Temporary activity creation | manager / `temporary` | Creator is authenticated without an account or new prompt. |
| Persistent teacher flow | manager / `persistent` | Existing teacher proof is exchanged server-side; no passcode reaches activity handlers. |
| Waiting-room acceptance | participant | Server chooses subject ID and sets the participant cookie. |
| Anonymous entrant | participant or scoped, without name | Supports Raffle; later claims are principal-bound and idempotent. |
| SyncDeck child launch | manager / `embedded` | Authenticated parent mints child-session-scoped authority, including credentialless children. |
| Learn server request | service / `learn` | HMAC remains server-to-server; a browser handoff exchanges into a normal browser principal. |
| Substitute instructor | manager / `substitute` | Bounded signed link is consumed and removed from the final URL. |
| Solo mode | outside live runtime or dedicated solo principal | Cannot weaken live-session manager or participant checks. |

## Threats the Contract Must Prove

1. A forged `studentId`, `participantId`, display name, or WebSocket `role` cannot
   read, mutate, or subscribe as another principal.
2. A session ID alone cannot control a manager surface or reveal an unprojected state.
3. A correct cookie for session A cannot authorize session B.
4. An unauthenticated socket receives neither its initial snapshot nor later delivery.
5. Manager-only and participant-private messages remain isolated through local and
   pub/sub delivery.
6. An embedded parent can grant child manager authority only for its intended child.
7. Cookie loss, expiry, and revoked capability produce one deterministic re-entry or
   manager-recovery path, not a reconnect loop.

## Migration Boundary

The agreed rollout is a clean cutover: live sessions created before the deployment do
not need compatibility. Do not add claimed-ID fallbacks, mixed old/new token maps,
migration markers, or query-string credentials. Migration PRs must move an activity's
manager HTTP and WebSocket surfaces together, then its participant surfaces and
projections together. Each PR adds the corresponding shared negative contract tests
and activity behavior tests.

The first implementation slice remains Java Format Practice. Postboard is the
REST/private-projection proof slice, followed by a mature multi-mode activity such as
Video Sync or MobCode. The raw shared-session disclosure advisory remains independently
scoped and must not be represented as fixed by this contract.
