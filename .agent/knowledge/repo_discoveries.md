# Repo Discoveries

Use this log for durable findings that future contributors and agents should reuse.

## Entry Template

- Date:
- Area: client | server | activities | tooling | docs
- Discovery:
- Why it matters:
- Evidence:
- Follow-up action:
- Owner:

## Discoveries

- Date: 2026-04-22
- Area: client | activities | syncdeck
- Discovery: SyncDeck overlay nav controls should not rely on native `disabled` buttons over embedded iframes; keep the control hit area active with handler guards plus `aria-disabled` so disabled-looking arrows still swallow pointer events instead of letting clicks pass through to the child iframe.
- Why it matters: A native disabled button does not handle the click itself. On embedded activity overlays that can let a click bleed into the child iframe, which makes a visually disabled nav arrow appear to dismiss or otherwise interact with the activity underneath.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: For future overlay controls layered above iframes, prefer guarded active elements with explicit disabled styling over native disabled controls when click-through would be unsafe.
- Owner: Codex

- Date: 2026-04-22
- Area: client | activities | syncdeck
- Discovery: SyncDeck student overlay forward navigation must treat `navigation.canGoForward` as the authoritative “catch up” signal and, when the student is behind only by fragment on the same `h:v` slide, send Reveal's local `right` command instead of a horizontal `setState`.
- Why it matters: `canGoRight` only describes strictly horizontal movement. If the host uses it as the primary forward capability, students who are behind by fragment on the same slide can lose their catch-up arrow; if the host then handles right-arrow presses as horizontal jumps, the control cannot advance through fragments correctly even when it is shown.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`
- Follow-up action: Keep student forward controls split between fragment/within-slide Reveal commands and anchored-slide `setState` moves, and prefer `canGoForward` over `canGoRight` whenever the product intent is “advance toward the released instructor position.”
- Owner: Codex

- Date: 2026-04-22
- Area: client | activities | syncdeck
- Discovery: SyncDeck manager should treat an inbound embedded `activityRequest` slide location as authoritative immediately, updating local instructor indices and asking the presentation iframe for a fresh `requestState` snapshot before waiting on child-session creation or a later deck state echo.
- Why it matters: Some presentation runtimes can emit `activityRequest` before the matching `state` payload settles. Without the optimistic anchor update plus explicit snapshot refresh, a last-slide embedded activity can intermittently leave the deck slide visible instead of opening the child overlay, and the overlay can keep stale horizontal arrow state from the previous slide.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep deck-driven embedded launches keyed to the request's resolved slide location, and refresh host navigation metadata from the iframe whenever an activity request becomes the newest authoritative anchor.
- Owner: Codex

- Date: 2026-04-21
- Area: client | activities | syncdeck
- Discovery: SyncDeck should scope `allow-popups-to-escape-sandbox` to instructor-configured presentation iframes only; embedded/internal iframes should keep the stricter sandbox without popup escape.
- Why it matters: `allow-popups` alone permits popup creation but keeps the new browsing context sandboxed, which breaks normal outbound navigation for presentation-authored external links. Restricting popup escape to presentation iframes preserves the narrower trust boundary for internal child activities.
- Evidence: `activities/syncdeck/client/shared/iframeSandbox.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Reuse the stricter base sandbox for embedded/internal SyncDeck iframes by default, and only opt into the presentation-specific escape token when unsandboxed new tabs are an explicit product requirement.
- Owner: Codex

- Date: 2026-03-27
- Area: server | activities | syncdeck
- Discovery: SyncDeck embedded child sessions must refresh lifetime in both directions: active parent SyncDeck traffic should touch launched child sessions, and any embedded child session read should also refresh the parent session via `embeddedParentSessionId`.
- Why it matters: Long-running SyncDeck classes can spend extended time on either the parent deck or a launched child activity. If only one side of that relationship refreshes TTL, the other session can be pruned and later re-entry fails with `invalid session` even though the lesson is still active.
- Evidence: `server/core/sessions.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `server/sessionStore.test.ts`
- Follow-up action: Preserve this coupling for future embedded activity work, and treat child-session `lastActivity` updates during parent keepalive as expected behavior in tests.
- Owner: Codex

- Date: 2026-03-29
- Area: client | activities | resonance
- Discovery: The Resonance student released-answer feed should preserve authored question order from `revealedQuestions` instead of re-sorting reveals by `sharedAt`.
- Why it matters: Standalone/self-paced released answers can accumulate multiple reveal cards, and timestamp sorting shows later-submitted questions first, which makes the review flow appear reversed relative to the activity's question sequence.
- Evidence: `activities/resonance/client/student/SharedResponseFeed.tsx`; `activities/resonance/client/student/SharedResponseFeed.test.tsx`
- Follow-up action: When adding future multi-question reveal or review surfaces in Resonance, treat the question list order as the canonical display sequence unless the UI intentionally exposes a chronological activity log.
- Owner: Codex

- Date: 2026-03-28
- Area: client | activities | syncdeck
- Discovery: SyncDeck embedded overlay nav buttons should treat iOS Safari touch `pointerdown` events as primary presses even when `PointerEvent.button` arrives as `-1`, otherwise the pointer path is skipped and the later synthetic click can double-advance the deck.
- Why it matters: The overlay intentionally navigates on press and then suppresses the follow-up click. If touch presses are filtered out as non-primary, mobile Safari can fall back to click-only behavior while the underlying presentation also reacts, producing the reported two-step move on embedded slides.
- Evidence: `activities/syncdeck/client/shared/embeddedOverlayNavigation.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Reuse the shared pointer-primary helper for future SyncDeck overlay controls instead of open-coding `event.button === 0` checks on touch-capable UI.
- Owner: Codex

- Date: 2026-03-27
- Area: client | activities | syncdeck
- Discovery: Recovered secondary instructors need a child-manager bootstrap backfill for already-running SyncDeck embedded activities because their local tab never initiated those child sessions and therefore never received the original `managerBootstrap` payload.
- Why it matters: Without that backfill, embedded manager iframes such as Resonance can mount with no instructor passcode in local bootstrap storage, which makes multi-instructor activity handoff look unsynced even though the parent SyncDeck session was recovered successfully.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/resonance/client/manager/ResonanceManager.tsx`
- Follow-up action: Reuse the same backfill pattern for future embedded manager flows that depend on same-tab bootstrap payloads instead of durable per-session recovery.
- Owner: Codex

- Date: 2026-03-27
- Area: server | activities | syncdeck
- Discovery: SyncDeck embedded activity starts need a server-side per-`sessionId:instanceKey` lock because client-side preload dedupe is only local to one instructor tab, and two instructors can otherwise race to create the same child session before the parent session record is updated.
- Why it matters: The route is only naturally idempotent after `session.data.embeddedActivities[instanceKey]` has been written. Serializing the create path inside a process keeps multi-instructor prewarm from spawning duplicate child sessions for the same slide anchor.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: If SyncDeck embedded starts ever need stronger cross-instance guarantees than sticky routing provides, move this lock to a shared Valkey-backed compare-and-set or lock primitive.
- Owner: Codex

- Date: 2026-03-23
- Area: client | activities | syncdeck
- Discovery: SyncDeck manager and student should not treat every inbound `reveal-sync` envelope as an iframe-ready signal now that the protocol includes descriptive `metadata` messages.
- Why it matters: A metadata-first emission order can otherwise flush queued commands and restore/replay state before the iframe has announced actual sync readiness, which risks brittle startup behavior while adding title metadata support.
- Evidence: `activities/syncdeck/client/shared/presentationMetadata.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep future non-readiness iframe actions out of the ready-signal allowlist unless they truly guarantee the deck can accept restore and sync commands.
- Owner: Codex

- Date: 2026-03-22
- Area: client | activities | vite
- Discovery: Vite 7 `import.meta.glob(...)` usage for cross-workspace activity discovery should use explicit relative/rooted filesystem globs, not the `@activities` path alias used for normal module imports.
- Why it matters: The shared activity registry and SyncDeck activity picker can end up with empty config maps at runtime even when the alias works for ordinary imports, which strips dashboard/activity cards from `/manage` and other picker surfaces.
- Evidence: `client/src/activities/index.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `client/vite.config.ts`; `node_modules/vite/dist/node/chunks/config.js`
- Follow-up action: Keep future `import.meta.glob` additions on `./`, `../`, or `/`-style paths and avoid alias-based glob patterns unless Vite explicitly documents support.
- Owner: Codex

- Date: 2026-03-22
- Area: client | activities | vite
- Discovery: Guarding transformed `import.meta.glob(...)` calls with `typeof import.meta.glob === 'function'` breaks runtime discovery in the browser because Vite rewrites the glob call but leaves the condition, and `import.meta.glob` itself is not a runtime function.
- Why it matters: After transform, the condition evaluates false in the browser and collapses the generated module maps to `{}`, which removes activity cards from `/manage` and home standalone surfaces even though the transformed module still contains the discovered imports.
- Evidence: `client/src/activities/index.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; live dev transform from `http://127.0.0.1:5173/src/activities/index.ts`
- Follow-up action: When test environments need a guard, key it off `import.meta.env` (or isolate the Vite-only module) rather than `typeof import.meta.glob`.
- Owner: Codex

- Date: 2026-03-22
- Area: client | server | activities | resonance
- Discovery: `activities/resonance/activity.config.ts` is now treated as a production activity config, so leaving `isDev: true` on Resonance removes its routes and dashboard card from non-dev builds.
- Why it matters: Both the client registry (`/manage` card emission and route registration) and server registry filter dev-only activities in production, so the flag makes Resonance effectively inaccessible outside development.
- Evidence: `activities/resonance/activity.config.ts`; `client/src/activities/index.ts`; `server/activities/activityRegistry.ts`
- Follow-up action: If Resonance needs a temporary hidden state again, use an explicit product gate instead of reusing the dev-only registry flag.
- Owner: Codex

- Date: 2026-03-21
- Area: docs | tooling | skills
- Discovery: Shared Codex skills are easiest to reuse across repos when the exported repo keeps a plain `skills/<skill-name>/...` tree and pushes repo-specific instructions into local overlay docs instead of modifying the vendored shared skill directly.
- Why it matters: This keeps subtree updates reviewable, avoids merge drift in vendored skill files, and gives agents a stable read order of shared base skill first and local overrides second.
- Evidence: `skills/syncdeck/SKILL.md`; `skills/syncdeck/references/EMBEDDED_ACTIVITIES.md`
- Follow-up action: When this skill is published to its own repo, keep consuming-repo specifics in a sibling local override file rather than editing the vendored subtree copy.
- Owner: Codex

- Date: 2026-03-21
- Area: docs | tooling | skills
- Discovery: ActiveBits now consumes the shared SyncDeck skill as a git subtree at `skills/syncdeck`, with `syncdeck-agent-skills` configured as the upstream remote and subtree push performed from that path.
- Why it matters: Future edits to the shared skill should happen in `skills/syncdeck` and be published with subtree push, rather than by maintaining a separate source copy in this repo.
- Evidence: `skills/README.md`; `skills/syncdeck/SKILL.md`; git remote `syncdeck-agent-skills`
- Follow-up action: If another shared skill is added, document its upstream remote and subtree path in `skills/README.md` so the edit/publish workflow stays discoverable.
- Owner: Codex

- Date: 2026-03-21
- Area: tooling | devcontainer
- Discovery: This devcontainer uses `/usr/local/bin/git` with exec path `/usr/local/libexec/git-core`, while `git-subtree` is installed at `/usr/lib/git-core/git-subtree`, so `.devcontainer/setup-dev.sh` now symlinks `git-subtree` into the active exec path during bootstrap.
- Why it matters: Without the symlink, `git subtree` fails unless contributors manually override `GIT_EXEC_PATH`, which makes subtree-based skill maintenance brittle for both humans and agents.
- Evidence: `.devcontainer/setup-dev.sh`; `git --exec-path`; `/usr/lib/git-core/git-subtree`
- Follow-up action: If the base image or git installation changes later, re-check whether the symlink workaround is still needed or whether the exec path is already consistent.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | validation
- Discovery: `parseGimkitCSV(...)` should enforce the documented maximum of three incorrect answers per row and then run parsed questions back through `validateQuestionSet(...)` before returning.
- Why it matters: This keeps CSV import behavior aligned with the rest of Resonance question validation, avoids producing out-of-bounds MCQs from extra trailing columns, and ensures imported rows get the same trimming and structural guarantees as JSON uploads.
- Evidence: `activities/resonance/shared/validation.ts`; `activities/resonance/shared/validation.test.ts`
- Follow-up action: If future CSV support expands beyond Gimkit's schema, update both the parser contract and exporter compatibility gate together.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | tools
- Discovery: Resonance's Gimkit CSV export compatibility gate must enforce the file format's four-option ceiling, not just the single-correct-answer rule, because the exporter only has columns for one correct answer plus three incorrect answers.
- Why it matters: Without the option-count guard, valid-looking multiple-choice questions with extra distractors would export lossy CSV rows that silently drop options and no longer match the authored question set.
- Evidence: `activities/resonance/client/tools/ResonanceToolShell.tsx`; `activities/resonance/client/tools/ResonanceToolShell.test.ts`
- Follow-up action: If the product ever needs wider CSV export support, add an explicit alternate export format or user-facing warning rather than truncating extra options.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | student-reactions
- Discovery: Student shared-response reactions are client-owned in `SharedResponseFeed`, which sends the existing `resonance:react-to-shared` websocket event only for shared free-response cards, uses the curated `STUDENT_REACTION_EMOJIS` set for the inline popout picker, renders aggregate reaction chips on the instructor's currently shared FRQ card, and now pairs that public reveal path with a separate `reviewedResponses` student-only snapshot payload for emoji-highlighted answers that were not shared publicly.
- Why it matters: Future reaction and feedback UI tweaks can stay local to the shared-response feed and shared-card display while keeping a clear separation between class-visible reveals and private instructor feedback; MCQ/poll reveal cards should remain non-reactive unless the product decision changes.
- Evidence: `activities/resonance/client/student/SharedResponseFeed.tsx`; `activities/resonance/client/student/ResonanceStudent.tsx`; `activities/resonance/client/manager/ResponseCard.tsx`; `activities/resonance/client/manager/ResponseViewer.tsx`; `activities/resonance/client/hooks/useResonanceSession.ts`; `activities/resonance/server/routes.ts`; `activities/resonance/shared/types.ts`; `activities/resonance/shared/emojiSet.ts`
- Follow-up action: If private feedback later needs timestamps or read/unread state, extend `reviewedResponses` directly instead of overloading the public `reveals` list.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | syncdeck | gamification-planning
- Discovery: SyncDeck already has a strong parent/child embedded-session foundation, including parent-owned child lifecycle, persisted `embeddedLaunch.selectedOptions`, child-session parent linkage, and host-to-activity `activebits-embedded` `syncContext` messaging. It does not yet have a generic reverse child-to-parent telemetry contract for embedded activities to report points or other aggregate progress back to the parent SyncDeck session.
- Why it matters: Gamification and cross-activity aggregation should extend the existing parent-owned SyncDeck session model rather than introducing activity-specific ad hoc callbacks. A parent-owned score ledger plus a small generic child score-ingest contract will fit the current architecture better than trying to make SyncDeck understand each child activity's internal session schema.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `client/src/components/common/embeddedLaunchBootstrap.ts`; `.agent/plans/syncdeck-gamification-plan.md`
- Follow-up action: Implement SyncDeck gamification as an additive parent-session contract first, then roll one embedded activity onto that contract before expanding to more activities.
- Owner: Codex

- Date: 2026-03-19
- Area: activities
- Discovery: The Resonance plan was updated to align with the current `ActivityConfig` schema and dashboard conventions: use `manageDashboard.customPersistentLinkBuilder`, `createSessionBootstrap.sessionStorage`, and activity-owned report/download flows instead of proposing a new shared `reporting` config or repo-wide report contract up front.
- Why it matters: Future Resonance work should build on the existing activity extension points already implemented in shared code, which keeps dashboard and registry layers activity-agnostic and avoids speculative schema churn.
- Evidence: `.agent/plans/resonance.md`; `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/java-string-practice/client/manager/JavaStringPracticeManager.tsx`
- Follow-up action: Only extract a shared reporting schema or report registration contract after a second activity demonstrates the same need.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: The Resonance embedded-activity plan now targets the same versioned websocket envelope shape as `video-sync`: `version`, `activity`, `sessionId`, `type`, `timestamp`, and `payload`, while keeping activity-specific namespacing in the `type` field (for example `resonance:session-state`).
- Why it matters: Future embeddable activities should converge on one outer message wrapper for shared-socket routing and forward compatibility instead of inventing per-activity envelope formats.
- Evidence: `.agent/plans/resonance.md`; `activities/video-sync/client/protocol.ts`
- Follow-up action: Reuse this outer envelope for future embedded-activity protocol plans unless a shared cross-activity transport spec supersedes it.
- Owner: Codex

- Date: 2026-03-19
- Area: server | activities | persistent-bootstrap
- Discovery: Persistent-session startup now copies canonical permalink `selectedOptions` into the started live session's `data.embeddedLaunch.selectedOptions`, and Algorithm Demo manager bootstrap reads its initial algorithm from that embedded-launch state instead of the manage-route query string.
- Why it matters: This removes the last manager bootstrap path that could be influenced by unsigned query edits after a persistent-link redirect while preserving canonical deep-link recovery for started sessions.
- Evidence: `server/core/persistentSessions.ts`; `server/core/persistentSessionWs.ts`; `server/routes/persistentSessionRoutes.ts`; `activities/algorithm-demo/client/manager/DemoManager.tsx`; `server/persistentSessionRoutes.test.ts`; `activities/algorithm-demo/client/manager/DemoManager.test.tsx`
- Follow-up action: For future persistent manager bootstrap needs, prefer `embeddedLaunch.selectedOptions` or explicit server recovery endpoints over re-reading manage-route query params.
- Owner: Codex

- Date: 2026-03-19
- Area: activities | video-sync | permalink-recovery
- Discovery: Video Sync manager bootstrap now prefers a server-recovered canonical `persistentSourceUrl` from `/api/video-sync/:sessionId/instructor-passcode` over raw manage-route query params when recovering persistent launches.
- Why it matters: This keeps manager bootstrap aligned with canonical permalink-selected options and prevents unsigned or drifted query params on the manage route from becoming authoritative during persistent-session recovery.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/server/routes.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`
- Follow-up action: Keep any future persistent manager bootstrap data on server-recovered or embedded-launch-selected-options paths rather than re-reading raw query params after redirect.
- Owner: Codex

- Date: 2026-03-19
- Area: activities | syncdeck | permalink-signing
- Discovery: SyncDeck permalink hashing now uses the shared canonical signer (`entryPolicy` + `selectedOptions.presentationUrl`) for generate, manager configure verification, and cookie-backed manager recovery; activity-specific `presentationUrl` hash logic was removed.
- Why it matters: SyncDeck create/edit/launch now verify the same canonical permalink state as shared persistent routes, reducing signer drift and making unsigned query params non-authoritative by design.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Treat canonical permalink signing as the default model for any future permalink-capable activity or recovery path; new activity-owned launch/recovery logic should consume only canonical signed state.
- Owner: Codex

- Date: 2026-03-19
- Area: server | permalink | canonical-state
- Discovery: Shared persistent permalink signing and verification now canonicalize `selectedOptions` from activity config `deepLinkOptions` keys, and ignore unsigned query params (for example `utm_source`) even when `urlHash` is present.
- Why it matters: This removes ambiguity where arbitrary query params could influence signed-state verification or runtime behavior, and aligns create/edit/auth/launch on one canonical signed permalink state.
- Evidence: `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `.agent/plans/permalink-signing-plan.md`
- Follow-up action: Canonical permalink signing is now the shared model. Future follow-up should focus only on keeping new activity-owned recovery/bootstrap paths aligned with canonical signed state instead of introducing parallel signers.
- Owner: Codex

- Date: 2026-03-18
- Area: client | waiting-room | standalone-permalinks
- Discovery: Persistent-link solo launches that cannot use a direct `/solo/:activityId` route should be handled through an optional activity client-module hook (`launchPersistentSoloEntry`) instead of adding activity-specific conditionals in the shared waiting-room component.
- Why it matters: Some activities, such as SyncDeck, support solo entry from permalinks but still require activity-owned session/bootstrap work before a student can enter. Keeping that logic in the activity client module preserves the activity-containment rule while letting shared waiting-room code stay generic.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/activities/index.ts`; `activities/syncdeck/client/index.tsx`
- Follow-up action: If another permalink-only standalone activity needs nontrivial bootstrap, implement the same hook in that activity's client module and return either a `sessionId` or explicit `navigateTo` target.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | activity-picker-metadata
- Discovery: SyncDeck's manager-side manual activity picker should source its launch list from activity config metadata via a local guarded `import.meta.glob(...)` read, not from the client activity registry module.
- Why it matters: The client registry eagerly uses Vite-only `import.meta.glob`, which breaks the Node-based activities test runner when imported directly into `SyncDeckManager`. A local guarded metadata read keeps the picker metadata-only, satisfies the activity-containment rule, and preserves server-render/unit test compatibility.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If other activity-owned manager views need config-only metadata, prefer the same guarded local pattern or extract a test-safe config loader instead of importing the full client registry.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | conversion-lab-stack-requests
- Discovery: The SyncDeck conversion-lab deck now emits sibling vertical activity anchors as `stackRequests` alongside the primary `activityRequest`, so entering `2:0` launches the whole `h:2` embedded stack (`2:0`, `2:1`, `2:2`) instead of only the currently visible anchor.
- Why it matters: Student overlay arrows derive vertical reach from known embedded instance keys. Without stack bootstrapping, moving to `2:1`/`2:2` before the instructor visited each anchor left the overlay thinking the stack had ended and showed incorrect “not started” or disabled-arrow behavior.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep deck-side stack metadata emission close to slide-activity metadata; if future decks need partial-stack launch behavior, make that an explicit per-deck policy instead of relying on missing sibling requests.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | overlay-arrow-setstate
- Discovery: SyncDeck manager and student embedded-overlay arrows now rely only on resolved `setState` targets from local/base slide indices and no longer fall back to raw directional Reveal commands when indices are unresolved.
- Why it matters: Raw fallback commands behave like Reveal document-order navigation, which can turn the overlay left arrow into a vertical move and leave up/down ineffective in embedded-stack flows. Explicit index targets keep host arrows aligned with the intended slide coordinates.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Preserve explicit index-driven overlay navigation unless the iframe-sync protocol later adds guaranteed strict-direction commands for horizontal and vertical movement.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | student-replay-suppression
- Discovery: Student replay of the latest instructor payload on iframe-ready now uses the same forward-suppression policy as live inbound handling (backtrack opt-out and vertical-independence guards), so suppressed instructor commands/states are not re-applied during iframe reconnect/ready replay.
- Why it matters: Without parity between live-forward and replay-forward paths, vertical `up/down` or stale `setState` payloads can still drag students or snap deck position unexpectedly even after live suppression logic is correct.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep replay and live-forwarding suppression paths centralized through shared helper logic to prevent policy drift.
- Owner: Codex

- Date: 2026-03-18
- Area: client | waiting-room | entry-participant-token-consume
- Discovery: Entry participant token consume now deduplicates concurrent consume calls per storage key/token on the client by sharing an in-flight promise.
- Why it matters: React StrictMode and parallel bootstrap effects can issue duplicate consume POSTs for the same token; deduping removes expected-but-noisy second-call 404s and prevents racey identity fallback behavior.
- Evidence: `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Follow-up action: Reuse this dedupe path for any future token-backed one-time handoff consumers instead of adding local effect guards in each activity.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | student-vertical-independence
- Discovery: Student now suppresses instructor `setState` sync when the move is vertical-only within the same horizontal stack (`h` unchanged, `v` differs), so instructor vertical navigation no longer drags student position.
- Why it matters: Embedded stack workflows require student-controlled vertical exploration while still allowing instructor horizontal progression and explicit force-sync commands.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep vertical-independence scoped to `setState`; preserve `syncToInstructor` for explicit instructor force-sync behavior.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | manager-activity-request-resync
- Discovery: When manager receives an `activityRequest` for an already-running anchored instance key (for example `embedded-test:2:0`), it now emits and relays an explicit `setState` resync command for that anchor instead of only logging/returning.
- Why it matters: Re-entering an active anchored activity can otherwise skip launch and leave students stuck on an older slide if they missed a prior navigation update; resync-on-skip forces students back to the anchor so overlays reopen.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Preserve this fallback until server-side acked per-student sync state can guarantee all participants reached the anchored slide before skip-existing short-circuits.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | student-embedded-reconcile
- Discovery: Student now reconciles `embeddedActivities` from `/api/session/:sessionId` when synchronized on a slide but no active anchored overlay is resolvable, and initial session hydration always applies the normalized embedded map (including empty snapshots).
- Why it matters: If a websocket lifecycle start/end event is missed, stale embedded maps can persist and block overlay re-entry even when instructor/student slide indices are synchronized.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep realtime WS as primary, but preserve snapshot reconciliation as drift correction for reconnect/race windows.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | conversion-lab-command-bridge
- Discovery: Conversion-lab now also triggers slide-enter activity emission when receiving inbound reveal `command` messages for `setState`/`syncToInstructor`, using command target indices as the source of truth.
- Why it matters: In host-driven navigation flows, status/slidechanged events can lag or miss transient transitions; command-level bridging ensures anchored activity requests still emit when the instructor jumps back to an activity slide.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`
- Follow-up action: Keep the command bridge as a fallback path while hosted runtime event timing is validated under instructor-driven setState control.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | conversion-lab-activity-emit
- Discovery: Conversion-lab now resolves activity metadata from authoritative sync indices (`h:v`) via DOM traversal instead of relying on `Reveal.getCurrentSlide()`, and slide-enter dedupe advances only after slide resolution succeeds.
- Why it matters: Host-driven `setState` can report updated indices before `getCurrentSlide()` points at the expected nested vertical section; advancing dedupe on that transient mismatch can suppress the later valid activityRequest when returning to anchors like `2:0`.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`
- Follow-up action: Keep slide-enter request emission keyed to resolved indexed slide elements rather than runtime-current slide references in host-driven navigation scenarios.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | conversion-lab-events
- Discovery: Conversion-lab slide-enter activity emission is now tied to status index transitions (`reveal-iframesync-status`/`getStatus().navigation.current`) with per-position dedupe, so host-driven `setState` navigation emits activity requests even when Reveal `slidechanged` does not fire.
- Why it matters: Instructor overlay navigation uses `setState`; without status-based detection, returning to anchors like `2:0` can miss relaunch requests and leave students synchronized but without an active overlay.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`
- Follow-up action: Keep deck-side emission keyed to authoritative sync status and avoid relying solely on local Reveal UI events for host-driven transitions.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | conversion-lab
- Discovery: The conversion-lab deck now emits `activityRequest` on every slide-enter (no permanent per-slide dedupe), relying on manager-side instanceKey idempotency to ignore duplicate starts while an anchored activity is already running.
- Why it matters: Revisiting anchors like `2:0` or vertical branches can relaunch overlays after an earlier lifecycle end instead of silently doing nothing due to stale deck-side dedupe state.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`
- Follow-up action: Keep deck emit behavior stateless; if duplicate suppression is needed, move it to manager/server where live instance state is authoritative.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | student-follow-mode
- Discovery: Student follow-mode now treats authoritative instructor `setState` as a forced rejoin when it targets an anchored embedded activity (or a non-forward correction), clearing backtrack opt-out and applying instructor indices locally.
- Why it matters: Backtrack opt-out can otherwise block overlay re-entry after instructor navigation changes from `syncToInstructor` to `setState`, which prevents returning to anchored slides and vertical embedded activity anchors from reopening for following students.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If Reveal runtime emits explicit command provenance for instructor-initiated state transitions, replace heuristic follow/force rules with provenance-based policy.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | manager-relay
- Discovery: Manager overlay `setState` navigation now arms outbound state restore-suppression and only releases suppression when the iframe reports the exact target indices, preventing stale state echoes from overwriting just-issued backward/vertical moves (for example returning to `2:0` then moving down).
- Why it matters: Without this guard, older iframe `state` packets can race behind a `setState` command, get relayed to the server, and make students reopen the previous anchored overlay even though instructor navigation already changed.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If the hosted Reveal runtime later exposes a monotonic command ack id, switch suppression from index-matching heuristics to ack-driven release.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | embedded-overlays
- Discovery: SyncDeck manager and student overlay navigation now updates local slide indices optimistically before waiting for the presentation iframe to echo a new reveal state, and the student fallback overlay resolver only falls back to instructor indices when local student indices are absent rather than merely unmatched.
- Why it matters: This makes embedded overlays close or swap immediately when users navigate away from the anchored slide instead of lingering until an async state echo arrives, and it avoids the student fallback path re-opening overlays after local navigation has already moved off the embedded slide.
- Evidence: `activities/syncdeck/client/shared/embeddedOverlayNavigation.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: If the hosted reveal runtime later exposes authoritative next-slide coordinates in navigation callbacks, replace the heuristic optimistic resolver with that runtime-provided destination.
- Owner: Codex

- Date: 2026-03-18
- Area: client | syncdeck | presentations
- Discovery: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html` now boots via hosted SyncDeck Reveal assets (`syncdeck-reveal.js` + `syncdeck-reveal.css`) and `initSyncDeckReveal({ deckId, ... })` instead of a hand-rolled postMessage simulator. Activity anchors are now encoded in slide `data-activity-*` attributes and bridged to host launches by calling `window.RevealIframeSyncAPI.sendCustom('activityRequest', ...)` on slide-enter/manual trigger.
- Why it matters: The conversion lab now exercises the real iframe sync runtime (navigation/status semantics and role handling) while preserving embedded activity launch testing without relying on the old synthetic state emitter.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`
- Follow-up action: If hosted runtime adds native slide metadata -> `activityRequest` emission, remove the deck-side bridge helper and keep only declarative `data-activity-*` metadata.
- Owner: Codex

- Date: 2026-03-18
- Area: client+server | embedded-session-ownership
- Discovery: Embedded child sessions (`CHILD:...`) are now explicitly parent-owned at both UI and API layers: shared `SessionHeader` auto-detects child session ids and hides join-code/end-session controls, and shared `DELETE /api/session/:sessionId` rejects child session ids with a 403 so only parent-session flows (for example SyncDeck embedded end route) can terminate them.
- Why it matters: This prevents embedded activity manager UIs from accidentally exposing destructive controls that break parent orchestration guarantees, while preserving a single authoritative end path in the parent session.
- Evidence: `client/src/components/common/SessionHeader.tsx`; `client/src/components/common/SessionHeader.test.tsx`; `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Add explicit instructor lock/hold capabilities as a separate feature instead of overloading session-end controls inside embedded managers.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | syncdeck | slide-activation
- Discovery: SyncDeck manager now consumes `reveal-sync` `activityRequest` messages from the presentation iframe, resolves `activityId` plus instance key (explicit `instanceKey`, payload `indices`, fallback instructor indices, otherwise `:global`), prompts instructor confirmation, and then calls `POST /api/syncdeck/:sessionId/embedded-activity/start`.
- Why it matters: This wires the first end-to-end launch seam for Phase 4 from deck events to server-backed embedded child session creation while preserving instructor confirmation and existing dedup semantics on the server.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `.agent/plans/syncdeck-checklist.md`; `.agent/plans/syncdeck-embedded-activities.md`
- Follow-up action: Complete remaining Phase 4 work by finalizing deck metadata/plugin emission conventions and adding integration coverage for request→prompt→launch→overlay flow.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | syncdeck | student-overlay
- Discovery: SyncDeck student now hydrates `embeddedActivities` from `session.data.embeddedActivities`, applies `embedded-activity-start`/`embedded-activity-end` websocket lifecycle payloads, and selects the active embedded overlay by matching `instanceKey` slide anchors against local student indices. The student host also extracts `canGoBack`/`canGoForward` from reveal state messages, renders host-layer navigation controls over the embedded iframe, and emits `activebits-embedded/syncContext` postMessages with `solo|synchronized|behind|ahead|vertical` state.
- Why it matters: This establishes the student-side Phase 3 host-overlay seam with late-join hydration and capability-driven navigation while keeping reveal transport and embedded activity transport separated.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `.agent/plans/syncdeck-checklist.md`; `.agent/plans/syncdeck-embedded-activities.md`
- Follow-up action: Complete the remaining solo activation path by reading `standaloneEntry` capability metadata and mounting direct `/solo/:activityId` routes when supported, then expand tests for stack transitions and solo launch behavior.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | syncdeck | manager-overlay
- Discovery: SyncDeck manager now keeps a local `embeddedActivities` keyed map hydrated from both session bootstrap data and `embedded-activity-start`/`embedded-activity-end` websocket lifecycle payloads. The active manager overlay is selected by parsing `instanceKey` anchors (`activityId:h:v`) against the current instructor slide indices, and when active it renders an iframe to `/manage/:activityId/:childSessionId` with host-side prev/next overlay navigation controls.
- Why it matters: This establishes the manager-side embedded orchestration seam for Phase 2 without coupling generic host logic to activity-specific protocols. It also ensures late-reconnect managers can recover running embedded instances from persisted session state before new websocket lifecycle events arrive.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `.agent/plans/syncdeck-checklist.md`; `.agent/plans/syncdeck-embedded-activities.md`
- Follow-up action: Finish the remaining Phase 2 items by adding richer running-panel status semantics and interaction-focused tests that exercise panel controls and overlay navigation behavior end-to-end.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | embedded | testing
- Discovery: The new `embedded-test` activity is the repo's thin dev-only harness for embedded activity contract validation. It is intentionally static, uses accepted-entry student identity on the websocket path, and exposes only a minimal manager/student roster-plus-chat surface to verify inherited identity, connection state, and child websocket isolation without coupling SyncDeck to a real rollout activity.
- Why it matters: Future embedded-activity work can validate generic lifecycle and identity behavior against a controlled target before debugging Video Sync or other real activity logic. Keeping the harness `isDev: true` also prevents it from leaking into production activity discovery.
- Evidence: `activities/embedded-test/activity.config.ts`; `activities/embedded-test/client/manager/EmbeddedTestManager.tsx`; `activities/embedded-test/client/student/EmbeddedTestStudent.tsx`; `activities/embedded-test/server/routes.ts`; `activities/embedded-test/server/routes.test.ts`
- Follow-up action: Use `embedded-test` first when exercising generic embedded launch/entry/reconnect flows, then confirm the same seams against the first real rollout activity rather than adding feature logic to the harness.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | syncdeck | contracts
- Discovery: SyncDeck embedded-activity Phase 0 contracts now explicitly separate transport responsibilities: parent SyncDeck websocket carries only lifecycle envelopes keyed by `instanceKey`, while each running child activity keeps an independent activity websocket (no multiplexed parent relay). The shared activity config contract also gained `embeddedRuntime.instructorGated?: 'runtime' | 'waiting-room'` so shared code can distinguish runtime gating from waiting-room hold behavior.
- Why it matters: This locks down Activity Containment boundaries before implementation and prevents accidental protocol coupling where SyncDeck starts relaying activity-specific realtime payloads. The enum contract gives activity teams a shared, metadata-driven way to preserve instructor control while still distinguishing pass-through runtime hold from waiting-room hold semantics.
- Evidence: `.agent/knowledge/data-contracts.md`; `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`
- Follow-up action: During Phase 1/3.5, keep websocket payloads activity-agnostic on the parent channel and read `embeddedRuntime.instructorGated` from config metadata rather than adding activity-specific conditionals in shared SyncDeck modules.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | waiting-room | syncdeck
- Discovery: SyncDeck embedded-activity planning should build on the waiting-room expansion that is already in the repo: `POST /api/syncdeck/:sessionId/embedded-context` proves inherited parent teacher/student identity, while child session entry should continue through the shared session entry gateway and entry-participant handoff contracts instead of inventing a separate child claim/join API.
- Why it matters: Reusing the shipped waiting-room seams keeps embedded child launch compatible with accepted-entry identity, extra waiting-room fields, and late-join flows. It also avoids creating a second incompatible entry model just for SyncDeck overlays.
- Evidence: `activities/syncdeck/client/shared/embeddedContextUtils.ts`; `activities/syncdeck/server/routes.ts`; `.agent/plans/waiting-room-expansion.md`; `.agent/knowledge/data-contracts.md`
- Follow-up action: When implementing embedded child launch, treat parent-context proof plus shared `GET /api/session/:sessionId/entry` and entry-participant consume routes as the default integration path; only add SyncDeck-specific embedded endpoints where they issue or transport inherited context, not where they replace the child activity's normal entry gateway.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | interoperability
- Discovery: `video-sync` now uses `instructor` as its canonical elevated websocket role and state-author identity so embedded SyncDeck presentations can pass a shared instructor role into Video Sync, but the server/client still accept legacy `manager` protocol values and normalize them to `instructor` during the rollout.
- Why it matters: Cross-activity embedding can rely on one elevated-role name, while mixed deployments or persisted pre-migration sessions do not break if an older client still sends `role=manager` or an older payload reports `updatedBy: 'manager'`.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `activities/video-sync/client/protocol.ts`; `activities/video-sync/client/protocol.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: Remove the `manager` compatibility path once all deployed Video Sync clients and persisted sessions have been rotated to the `instructor` protocol naming.
- Owner: Codex

- Date: 2026-03-17
- Area: activities | waiting-room
- Discovery: `video-sync` now follows the shared waiting-room identity contract on the student side: the activity declares a required `displayName` field, and the student client resolves/persists a stable participant identity through `resolveInitialEntryParticipantIdentity(...)` and session participant context instead of inventing a fresh telemetry-only ID every mount.
- Why it matters: This brings Video Sync onto the same preflight identity path as the other migrated session-backed activities, so telemetry and reconnect-friendly local context can reuse waiting-room-issued `participantId` values. It also narrows the remaining gap: Video Sync still keeps its websocket/session authorization model activity-owned rather than enforcing accepted-entry identity on join.
- Evidence: `activities/video-sync/activity.config.ts`; `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: If Video Sync later needs server-enforced waiting-room identity, extend the same participantId into its websocket or event-ingestion authority model instead of reintroducing client-generated student IDs.
- Owner: Codex

- Date: 2026-03-04
- Area: activities
- Discovery: `video-sync` students intentionally keep a blackout overlay until the instructor has explicitly started playback. A session with a configured `videoId` but `isPlaying === false` and `positionSec === startSec` is still considered "not started", so permanent-link bootstrap flows must send an initial `play` transition instead of only saving config.
- Why it matters: Configuring the video source alone is not enough to let students see playback. Flows that promise "jump straight into the video" need to move the shared state past the pre-start gate or students will remain stuck on the waiting overlay.
- Evidence: `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`
- Follow-up action: Keep permanent-link/bootstrap flows aligned with the student start gate, and if the product ever wants students to see a cued-but-paused frame instead, change `hasInstructorPlaybackStarted(...)` deliberately rather than assuming config is sufficient.
- Owner: Codex

- Date: 2026-03-04
- Area: activities
- Discovery: `video-sync` read-path session normalization is persistence-worthy when it repairs malformed stored data. `GET /api/video-sync/:sessionId/session` should call `sessions.set(...)` if normalization changed persisted fields such as `instructorPasscode`, `state.videoId`, `state.serverTimestampMs`, or truncated telemetry error fields, even when playback projection and connection telemetry did not otherwise require a write.
- Why it matters: In Valkey mode, `sessions.get()` returns a deserialized copy, so normalization fixes are lost unless the route explicitly persists them. Without this, malformed sessions can remain broken indefinitely and every read repeats the same repair work.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: When adding new persisted `video-sync` fields, include them in normalization-change expectations and keep the read-path persistence tests aligned with that contract.
- Owner: Codex

- Date: 2026-03-04
- Area: activities
- Discovery: In `video-sync`, Valkey-backed `unsync` and successful `sync-correction` event handlers should reuse the count returned by the upsert/clear Lua scripts instead of immediately issuing a second count-script `EVAL`; the standalone count script is still the source of truth for heartbeats, session reads, and stale-entry pruning.
- Why it matters: Event requests are the hot path for drift telemetry. Reusing the mutation-script return value cuts redundant Valkey work roughly in half for those events while preserving cross-instance correctness and leaving periodic/read refresh paths intact.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: If other activity-local Valkey telemetry paths add mutation scripts with deterministic counts, prefer threading those counts through response/persistence code before adding separate recount calls.
- Owner: Codex

- Date: 2026-03-04
- Area: activities
- Discovery: In Valkey mode, `video-sync` no longer keeps unsynced-student telemetry purely in process. The server stores per-session unsynced-student timestamps in a short-lived Valkey-backed key, and reads/prunes that shared key when computing `telemetry.sync.unsyncedStudents`; the in-memory map/timer path is now only the fallback for non-Valkey development mode.
- Why it matters: In horizontally scaled deployments, `/api/video-sync/:sessionId/event` requests can hit different instances. Without shared storage, `sync.unsyncedStudents` oscillates or resets incorrectly; with the Valkey-backed key, the manager sees a cross-instance coherent count.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `DEPLOYMENT.md`
- Follow-up action: If `video-sync` needs stronger cross-instance telemetry guarantees later, consider moving the unsynced-student key handling into a shared helper or adding explicit compare-and-swap semantics for other activity-local Valkey state.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: `video-sync` treats `stopSec` as a server-authoritative playback boundary, not an advisory client-only hint. Server command handling clamps play/pause/seek positions to `stopSec`, heartbeat projection caps playback at that boundary, and state persistence auto-pauses once the stop point is reached.
- Why it matters: Planning/docs language that describes stop time as merely advisory is incorrect and can lead to regressions if future contributors remove the server-side enforcement that currently keeps manager and student playback bounded consistently.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `.agent/plans/video-sync-activity-plan.md`
- Follow-up action: Keep plan/docs/tests aligned with the enforced-stop behavior unless the product decision explicitly changes to allow seeking or playback beyond `stopSec`.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: `video-sync` drift correction and telemetry are keyed to a `0.2s` tolerance and current sync-health state, not a cumulative unsync-event threshold. Student clients report `unsync` when drift first exceeds tolerance, throttle repeated unsync reports to once per 10 seconds while still unsynced, and the manager consumes `sync.unsyncedStudents`, `sync.lastDriftSec`, and `sync.lastCorrectionResult`.
- Why it matters: Plan language that describes unsync reporting as a two-heartbeat `2.0s` threshold or expects `sync.unsyncEvents` no longer matches the shipped protocol and can mislead future telemetry or dashboard changes.
- Evidence: `activities/video-sync/client/syncMath.ts`; `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/protocol.ts`; `activities/video-sync/server/routes.ts`; `.agent/plans/video-sync-activity-plan.md`
- Follow-up action: Keep plan/docs aligned with the opportunistic, throttled `unsync` reporting model unless the telemetry contract is intentionally redesigned.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: `GET /api/video-sync/:sessionId/session` now returns projected playback state without persisting on ordinary reads. It only calls `sessions.set(...)` when the read causes a durable transition, such as auto-pausing at `stopSec` or changing telemetry counts.
- Why it matters: Frequent polling/reconnects no longer create avoidable Valkey or session-store write churn, while clients still receive current projected playback and durable stop-boundary enforcement remains persisted when reached.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: Preserve this read-path write policy if additional session-read telemetry or projection logic is added later.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: `video-sync` server-side `parseYouTubeSource` now normalizes YouTube IDs with a strict 11-character pattern (`[A-Za-z0-9_-]{11}`), and short URLs (`youtu.be/...`) use only the first non-empty path segment as the candidate ID.
- Why it matters: Prevents persisting malformed IDs (for example IDs containing invalid characters or extra path suffixes) while still accepting share links like `https://youtu.be/<id>/extra` by extracting just `<id>`.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: Keep client and server ID-validation behavior aligned if future URL formats are added.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: `video-sync` student overlay keyboard filtering now blocks only known YouTube/media-control keys (space, transport letters, arrows, paging/home-end, and digits) instead of every key except `Tab`/`Escape`.
- Why it matters: The focusable full-screen overlay still suppresses accidental player control keys but no longer swallows unrelated keyboard navigation/assistive shortcuts while focused.
- Evidence: `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`
- Follow-up action: If additional browser/player shortcuts need suppression, extend `BLOCKED_STUDENT_OVERLAY_KEYS` with explicit keys and add matching tests rather than broad default blocking.
- Owner: Codex

- Date: 2026-03-03
- Area: activities
- Discovery: Activity client entry modules that import sibling manager/student files under the `activities` workspace should use explicit `.js` specifiers for relative ESM imports, even when the source files are `.ts`/`.tsx`.
- Why it matters: `node --test` with `tsx` resolves these activity entry imports at runtime using Node ESM semantics, so extensionless relative specifiers can fail while `.js` specifiers match the emitted/runtime module shape used elsewhere in the repo.
- Evidence: `activities/video-sync/client/index.ts`; `activities/syncdeck/client/index.tsx`; `activities/algorithm-demo/client/index.tsx`; `activities/package.json`
- Follow-up action: When adding or updating `activities/*/client/index.ts` or `.tsx`, mirror the existing `.js` import pattern for sibling manager/student modules and keep activity-scoped tests in the validation path.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: `video-sync` student view now keeps an opaque overlay above the embedded YouTube player until instructor playback has actually started (`state.isPlaying` or synced position advancing past `startSec`), which hides the initial YouTube spinner/loading state from students.
- Why it matters: Students see a consistent classroom-ready waiting state instead of a distracting/ambiguous player spinner before the teacher presses play, while synchronized playback behavior remains unchanged once playback begins.
- Evidence: `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`
- Follow-up action: If instructors need manual reveal controls independent of playback state, add an explicit session-level reveal flag in the video-sync protocol instead of inferring from position/play status.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: `video-sync` telemetry now treats unsync as per-student live state (`sync.unsyncedStudents`) instead of a cumulative incident counter; student clients send a stable `studentId` with `unsync` and `sync-correction` events, and the server keeps a per-session unsynced-student map with stale-entry pruning.
- Why it matters: The instructor HUD can display “currently unsynced students” in real time, which is actionable during class playback, and stale tabs no longer keep the count inflated indefinitely.
- Evidence: `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: If class sessions need stronger identity guarantees across reconnects, consider deriving/validating student identity from session auth rather than client-generated IDs.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: Video Sync does not currently have a general manager-auth flow for join-code sessions or multi-manager websocket access; outside the permalink waiting-room/passcode path, `role=manager` is a known trust assumption rather than an enforced security boundary.
- Why it matters: Manager websocket auth cannot be tightened safely in isolation yet, because rejecting unauthenticated manager sockets would break the current workflow and there is no server-issued credential flow for normal manager entry.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/activity.config.ts`
- Follow-up action: If Video Sync needs manager-only websocket authorization, introduce a real manager credential flow first; a future join-code-based manager entry is the likely place to lock this down without breaking multi-manager use.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: Video Sync playback/control endpoints (`/api/video-sync/:sessionId/command` and config patch flow) are likewise unauthenticated today; possession of the sessionId is effectively enough to issue manager-style state changes.
- Why it matters: This is the HTTP analogue of the unauthenticated manager websocket role assumption: students or anyone who can guess/obtain the sessionId can currently grief playback unless a broader manager-auth mechanism is added.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: Treat manager authorization as a single cross-cutting gap for Video Sync; when a real manager credential flow is introduced, apply it consistently to both websocket role elevation and command/config HTTP endpoints.
- Owner: Codex

- Date: 2026-02-28
- Area: activities
- Discovery: The new `video-sync` activity uses a versioned websocket envelope (`version`, `activity`, `sessionId`, `type`, `timestamp`, `payload`) for all realtime traffic (`state-snapshot`, `state-update`, `heartbeat`, `telemetry-update`, `error`) so message parsing remains forward-compatible as payload shapes evolve.
- Why it matters: Activity clients can validate a stable outer contract while adding new message types or payload fields without brittle string/shape checks tied to one message body format.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/client/protocol.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: Reuse this envelope shape for future realtime activities and consider extracting a shared typed helper in `types/` if multiple activities adopt the same protocol wrapper.
- Owner: Codex

- Date: 2026-03-16
- Area: tooling
- Discovery: Both devcontainer profiles should treat `.devcontainer/setup-dev.sh` as the single source of truth for npm bootstrapping, with each `postCreateCommand` delegating version enforcement to that script before running workspace installs.
- Why it matters: Keeping the npm pin in multiple `devcontainer.json` files and `setup-dev.sh` creates drift risk during future Node/npm upgrades and makes local container setup harder to reason about.
- Evidence: `.devcontainer/devcontainer.json`; `.devcontainer/privileged/devcontainer.json`; `.devcontainer/setup-dev.sh`
- Follow-up action: If future bootstrap requirements are added for both container creation and startup, prefer extending `setup-dev.sh` or a helper it calls instead of duplicating literals in devcontainer metadata.
- Owner: Codex

- Date: 2026-03-16
- Area: tooling
- Discovery: Workspace engine constraints should stay identical across the root, `client`, `server`, and `activities` manifests. A looser child-package range is misleading because npm workspace installs are gated by the root `engines.node` value first.
- Why it matters: Contributors and CI can waste time reasoning about Node versions that appear supported in a child package but are impossible to use from the monorepo root.
- Evidence: `package.json`; `client/package.json`; `server/package.json`; `activities/package.json`
- Follow-up action: When raising the repo Node floor, update all workspace manifests in the same change and only document exceptions if a package is intentionally published or used outside the monorepo.
- Owner: Codex

- Date: 2026-03-16
- Area: tooling
- Discovery: `.devcontainer/setup-dev.sh` runs as the configured `remoteUser`, so global npm upgrades must retry with `sudo` when the base image’s global prefix is root-owned.
- Why it matters: With `set -e`, a plain `npm install -g npm@...` can abort devcontainer creation for the default `vscode` user even though `sudo` is available in the image.
- Evidence: `.devcontainer/devcontainer.json`; `.devcontainer/setup-dev.sh`
- Follow-up action: Keep devcontainer bootstrap steps privilege-aware whenever they write outside the workspace or the user’s home directory.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: WebSocket student-join handlers that rely on accepted-entry identity should fail closed when identity cannot be resolved. `java-format-practice`, `java-string-practice`, `traveling-salesman`, and `python-list-practice` now send an explicit WS error payload and close with code `1008`/reason `waiting-room-required` instead of returning early and leaving an unresolved socket connected.
- Why it matters: Returning early on unresolved identity leaves a live socket without a valid participant binding, which can cause stale connections and reconnect loops. Closing with a policy code enforces waiting-room-first entry semantics and makes client recovery paths deterministic.
- Evidence: `activities/java-format-practice/server/routes.ts`; `activities/java-string-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`; `activities/python-list-practice/server/routes.ts`
- Follow-up action: Apply the same fail-closed contract to any new activity websocket join path that depends on accepted-entry records, and consider adding shared helper utilities for this rejection pattern to reduce route duplication.
- Owner: Codex

- Date: 2026-03-14
- Area: server | testing
- Discovery: Waiting-room route coverage is now broad enough to validate most current entry-gateway API edges without a browser harness. `persistentSessionRoutes.test.ts` covers malformed permalink entry requests, corrupted cookie parsing, stale backing-session repair, student/teacher live-entry role differences, and solo-unavailable permalink outcomes, while `sessionEntryRoutes.test.ts` covers missing-session and token-trimming behavior for live entry-participant handoff routes.
- Why it matters: The remaining test gaps are now concentrated in still-unimplemented embedded-role inheritance and `WaitingRoom.tsx` component interactions rather than basic entry-route correctness. That keeps future effort focused on real product gaps instead of more route boilerplate.
- Evidence: `server/persistentSessionRoutes.test.ts`; `server/sessionEntryRoutes.test.ts`; `server/entryStatus.test.ts`
- Follow-up action: When embedded entry work lands, add route/integration coverage there first; for `WaitingRoom.tsx`, extend the new presentational seam and only add a heavier browser-style harness if interaction coverage still cannot be reached through the existing client test stack.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` now has a pure presentational seam in `WaitingRoomContent.tsx`, which can be tested directly in the Node client suite even though the full container still depends on the Vite activity loader.
- Why it matters: This removes the earlier all-or-nothing testing boundary around the waiting-room UI. We can now cover accessibility wiring, teacher-control disabled states, and other rendering-critical behavior without introducing Playwright or reworking the activity loader just to test one shared component.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/WaitingRoomContent.tsx`; `client/src/components/common/WaitingRoomContent.test.tsx`
- Follow-up action: Add more render-level cases through the seam as waiting-room UI evolves, and reserve any future browser-harness work for behavior that genuinely needs end-to-end navigation, websocket timing, or storage integration.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` carry-forward persistence now has its own stable helper seam in `waitingRoomHandoffUtils.ts`, covering the high-risk branch between successful server-backed token storage and local-value fallback.
- Why it matters: This closes another part of the earlier “full container or nothing” testing gap without introducing Playwright. The current client test stack can now verify that waiting-room exit data is preserved correctly across success, failure, and malformed-token responses before any heavier browser harness is justified.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomHandoffUtils.ts`; `client/src/components/common/waitingRoomHandoffUtils.test.ts`
- Follow-up action: Keep extracting similarly narrow `WaitingRoom` seams for websocket/wait-state transitions if needed, and only revisit browser-level tooling once those seams stop covering the remaining risky behavior.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` websocket message handling now also has a stable seam in `waitingRoomTransitionUtils.ts`, so teacher-auth, session-started, session-ended, waiter-count, and teacher-code-error routing can be verified without importing the full container into a browser-style harness.
- Why it matters: This narrows the remaining waiting-room test gap again. The hard-to-reach portion is no longer “all websocket behavior,” it is the lifecycle wiring around open/close/error and any true end-to-end submission path that still spans the container boundary.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomTransitionUtils.ts`; `client/src/components/common/waitingRoomTransitionUtils.test.ts`
- Follow-up action: If more waiting-room test depth is needed, prefer a small seam around websocket lifecycle error/close handling next; only revisit Playwright or another browser harness if that final boundary still resists direct coverage.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` now has direct helper coverage for both of its remaining substantial async branches: cookie-backed teacher auto-auth on websocket open (`waitingRoomAutoAuthUtils.ts`) and post-auth teacher-code submit routing (`waitingRoomTeacherSubmitUtils.ts`).
- Why it matters: This means the seam-first strategy has covered most of the risky `WaitingRoom` decision logic without adding Playwright. What remains is mostly container wiring across websocket lifecycle events and true end-to-end form/network interaction, not large untested logic branches.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomAutoAuthUtils.ts`; `client/src/components/common/waitingRoomAutoAuthUtils.test.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.test.ts`
- Follow-up action: If additional `WaitingRoom` confidence is still needed, decide explicitly whether the remaining container-wiring risk justifies a higher-level interaction harness instead of extracting more tiny helpers.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` websocket handler wiring now has its own seam in `waitingRoomSocketUtils.ts`, so the branch no longer relies on implicit coverage for `onopen`, `onmessage`, `onerror`, and `onclose` attachment behavior.
- Why it matters: This essentially exhausts the low-cost seam-first testing path for `WaitingRoom`. The remaining untested area is no longer hidden business logic; it is true container-level interaction across form submission, network calls, and router/runtime boundaries.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomSocketUtils.ts`; `client/src/components/common/waitingRoomSocketUtils.test.ts`
- Follow-up action: If the team wants more than this, make an explicit choice about a higher-level interaction harness rather than continuing to peel off tiny shared helpers.
- Owner: Codex

- Date: 2026-03-14
- Area: server | docs
- Discovery: The main open waiting-room architecture question is no longer “join-code vs permalink flow.” Those flows now share the same entry-status and handoff model while intentionally keeping separate `sessionId` and `hash` entrypoints. The more important remaining question is whether post-handoff participant acceptance/reconnect should stay as today’s shared-helper boundary or move into one broader accepted-entry service.
- Why it matters: This narrows the branch’s next step to a real product/runtime decision. More time spent trying to unify entry URLs or peel off additional `WaitingRoom` helpers would add less value than deciding how authoritative shared `participantId` should become after handoff.
- Evidence: `.agent/plans/waiting-room-expansion.md`; `server/core/entryStatus.ts`; `server/core/entryParticipants.ts`; `server/core/sessionParticipants.ts`; `server/core/participantSockets.ts`
- Follow-up action: If implementation continues on this branch, prioritize a concrete accepted-entry service decision before more activity migration or more waiting-room-only test work.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: Live session handoff is no longer only “consume token, return values.” The consume route now also records accepted participant identity on the session itself in `acceptedEntryParticipants`, keyed by `participantId`.
- Why it matters: This is the first server-side record that survives beyond the one-shot token consume and can become the basis for a more authoritative accepted-entry contract. It narrows the next implementation question from “should the server remember accepted entry at all?” to “which activity join/reconnect paths should consult that remembered acceptance first?”
- Evidence: `server/core/acceptedEntryParticipants.ts`; `server/core/sessions.ts`; `server/acceptedEntryParticipants.test.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Start with one or two session-backed activities and let websocket join prefer accepted-entry identity by `participantId`, then decide whether that should become a broader shared join/reconnect rule.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: The first accepted-entry join fallback is now live in the migrated Java activities. Their websocket join paths can recover the participant name from the server-side `acceptedEntryParticipants` record when the client reconnects with `participantId` but without `studentName`.
- Why it matters: This is the first point where accepted entry affects actual join behavior instead of only being remembered on the server. It reduces reliance on the client resending the display name after waiting-room handoff and makes the remaining gap more specific: other activities and broader reconnect rules still need a shared authority decision.
- Evidence: `server/core/acceptedEntryParticipants.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`
- Follow-up action: If we continue on this branch, decide whether to extend this fallback to more session-backed activities or to pause and design a broader accepted-entry join/reconnect service before spreading the pattern further.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Accepted-entry reconnect is now a real shared service, not just a pair of Java-specific route edits. `connectAcceptedSessionParticipant()` centralizes the “use explicit name or fall back to accepted-entry name by `participantId`, then run shared connect/reconnect logic” pattern, and `traveling-salesman` now uses it alongside the Java activities.
- Why it matters: This is the first reusable server entry service in the post-handoff space. It proves that accepted-entry authority can be shared without collapsing all activity join behavior into one route, while also making the next gap clearer: Python List Practice and SyncDeck still need an explicit decision about whether to join this service or keep their activity-owned entry semantics.
- Evidence: `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`
- Follow-up action: Python List Practice has now joined this service too, so the remaining adoption question is mostly SyncDeck. The broader architectural question is whether this service is “enough shared authority” or should grow into a more comprehensive accepted-entry contract that also governs later reconnect/mutation surfaces.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Python List Practice now also uses the shared accepted-entry connect service through its activity-owned `connectPythonListPracticeStudent(...)` wrapper.
- Why it matters: This shows the service is not just for the initially migrated Java/traveling-salesman activities. It can support another session-backed activity with slightly different helper structure without forcing a rewrite of that activity’s stats/update paths.
- Evidence: `activities/python-list-practice/server/studentParticipants.ts`; `activities/python-list-practice/server/studentParticipants.test.ts`; `server/core/acceptedSessionParticipants.ts`
- Follow-up action: Decide explicitly whether SyncDeck should stay on its separate registration-first model or whether a future shared accepted-entry contract should bridge that gap too.
- Owner: Codex

- Date: 2026-03-14
- Area: server | client | testing
- Discovery: Waiting-room entry semantics are now testable at a stable helper boundary instead of only through route/component flows: `server/core/entryStatus.ts` covers shared join/wait/solo/pass-through decisions, `server/core/sessionEntryParticipants.ts` covers tokenized live-entry handoff normalization/one-shot consume behavior, and `entryParticipantStorage` covers client-side 404-vs-retry token handling.
- Why it matters: The branch’s remaining test gaps are now narrower and easier to reason about. We can add high-signal matrix coverage for shared entry behavior without forcing a brittle DOM harness around the whole `WaitingRoom` component before the API contracts settle.
- Evidence: `server/entryStatus.test.ts`; `server/sessionEntryParticipants.test.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Follow-up action: Add targeted `WaitingRoom.tsx` interaction tests later for required-field blocking and carry-forward once the shared helper and route contracts stop moving.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Participant ID minting is now centralized in `server/core/participantIds.ts`, and multiple activity server paths (`java-string-practice`, `java-format-practice`, `traveling-salesman`, SyncDeck registration) reuse the same 16-hex format instead of each route inventing its own timestamp/random pattern.
- Why it matters: This is the first concrete server-side step toward a shared `participantId` contract, and it removes name-derived or route-shaped ID differences before reconnect semantics are centralized.
- Evidence: `server/core/participantIds.ts`; `server/participantIds.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`
- Follow-up action: Centralize participant lookup/reconnect behavior next; generation format alone is not enough to make participant identity portable across activities.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now centralizes the common “reconnect by ID or create a participant record” flow for session-backed student arrays, and `java-string-practice`, `java-format-practice`, and `traveling-salesman` all use it.
- Why it matters: This is the next real step after shared ID generation: the branch now has one reusable reconnect/create rule for multiple activities instead of repeating subtly different `find(...)` and mutation logic in each websocket route.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`
- Follow-up action: Migrate Python List Practice and evaluate whether SyncDeck's REST registration + websocket reconnect path should converge on the same helper or a broader shared participant-entry service.
- Owner: Codex

- Date: 2026-03-14
- Area: activities | docs
- Discovery: The current activities split into three migration buckets for waiting-room/participant work. Good-fit identity migrations are `java-string-practice`, `java-format-practice`, `traveling-salesman`, and likely `python-list-practice`; low-priority or special-case deferrals are `raffle`, `gallery-walk`, `syncdeck`, `www-sim`, and mostly `algorithm-demo`.
- Why it matters: Future work should not treat every activity as if it needs the same waiting-room identity flow. Some activities mainly need shared participant entry, while others use local storage for workflow state (`raffle` ticket caching, `www-sim` hostname workspace state) or have specialized solo/reviewer flows that need separate design (`gallery-walk`, `syncdeck`).
- Evidence: `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `activities/traveling-salesman/client/student/TSPStudent.tsx`; `activities/python-list-practice/client/student/PythonListPractice.tsx`; `activities/raffle/client/student/TicketPage.tsx`; `activities/gallery-walk/client/student/StudentPage.tsx`; `activities/syncdeck/server/routes.ts`; `activities/www-sim/client/student/WwwSim.tsx`; `activities/algorithm-demo/client/student/DemoStudent.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Keep these notes as deferred migration guidance until the remaining Phase 0-3 waiting-room work is complete, then prioritize `python-list-practice` and `traveling-salesman` before revisiting the special-case activities.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Started persistent sessions no longer always bypass the waiting-room shell. When an activity declares `waitingRoom.fields`, `SessionRouter` now routes already-started permalink entry through `WaitingRoom` with a `join-live` outcome, while activities without fields keep the simpler direct join card.
- Why it matters: This preserves the plan's "collect preflight while waiting and carry it into entry" direction for started-session joins too, so required participant fields are not silently skipped just because the teacher already launched the session before the student arrived.
- Evidence: `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomViewUtils.ts`
- Follow-up action: Fold the same preflight-aware gateway into ad-hoc `/:sessionId` join-code entry so permalink and join-code flows stop diverging on required entry fields.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Direct `/:sessionId` join-code entry can now reuse `WaitingRoom` as a field-only `join-live` preflight shell by disabling teacher/share affordances and completing entry through a callback instead of navigation.
- Why it matters: This reduces the biggest functional gap between permalink and join-code entry for activities that declare `waitingRoom.fields`, without blocking on the larger future server-side participant-entry contract.
- Evidence: `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/sessionEntryRenderUtils.ts`
- Follow-up action: Replace the client-only completion callback with a shared entry handoff that submits/stores participant preflight data and works consistently for both permalink and direct session joins.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Direct `/:sessionId` joins no longer treat `/api/session/:sessionId` as both gateway lookup and runtime payload. The server now exposes `GET /api/session/:sessionId/entry`, and `SessionRouter` uses that entry-status response first to decide whether join-code entry should render the waiting-room shell or pass straight through before it fetches the full session record.
- Why it matters: This is the first server-backed gateway step for ad-hoc join-code entry, so permalink and join-code flows now share the same broad shape of “entry metadata first, activity payload second” instead of join-code being only a client-side preflight wrapper.
- Evidence: `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/sessionEntryRenderUtils.ts`; `types/waitingRoom.ts`
- Follow-up action: Unify the persistent-link and join-code gateway endpoints once participant handoff moves server-side; right now they still expose parallel entry contracts even though the client flow is more aligned.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Permalink entry now follows the same server-backed “entry metadata first” pattern as join-code entry. The server exposes `GET /api/persistent-session/:hash/entry`, and `SessionRouter` now uses that route’s resolved role/outcome/presentation payload instead of recomputing permalink status on the client from `entryPolicy`, teacher cookie, and session-start flags.
- Why it matters: This removes another split-brain decision path from the client and brings permalink and join-code entry much closer to the same gateway model, even though the backend still uses separate persistent-session and direct-session lookup endpoints.
- Evidence: `server/core/persistentSessionEntryStatus.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `types/waitingRoom.ts`
- Follow-up action: The next true unification step is backend-side, not router-side: collapse the parallel entry-status endpoints into one shared gateway abstraction once participant handoff and role inheritance rules are stable enough.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: Even though join-code and permalink entry still use different REST endpoints, their entry-status payload assembly no longer lives in separate route-local logic. `server/core/entryStatus.ts` now builds both the direct-session and persistent-session gateway decisions.
- Why it matters: This is the first backend-side unification seam for the waiting-room gateway. It reduces the risk that one entry surface drifts on `presentationMode` or destination rules while the other keeps evolving.
- Evidence: `server/core/entryStatus.ts`; `server/core/sessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: Move shared lookup/normalization around that builder next if we want one true gateway service instead of just one shared decision function.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: The opaque waiting-room participant handoff now has one shared backend normalization/token helper in `server/core/entryParticipants.ts`, and both the live-session wrapper (`sessionEntryParticipants.ts`) and persistent-session wrapper (`persistentSessions.ts`) delegate to it.
- Why it matters: This keeps `participantId` minting, serializable-value filtering, token shape, and one-shot consume behavior aligned across the two entrypoints without pretending the surrounding session lookup lifecycles are identical.
- Evidence: `server/core/entryParticipants.ts`; `server/core/sessionEntryParticipants.ts`; `server/core/persistentSessions.ts`; `server/entryParticipants.test.ts`; `server/sessionEntryParticipants.test.ts`; `server/persistentSessionRoutes.test.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Reuse this helper if more entry-backed contexts appear, and keep the wrapper modules responsible only for container lookup/persistence rather than reintroducing token/normalization logic there. The next non-refactor step after this helper is not more token plumbing; it is defining the shared post-handoff participant acceptance/reconnect contract.
- Owner: Codex

- Date: 2026-03-13
- Area: client | activities
- Discovery: Waiting-room exit now writes collected values into a shared sessionStorage handoff keyed by destination (`session` or `solo`), and `java-string-practice` consumes that handoff's `displayName` to skip its duplicate live-session name prompt when preflight already captured it.
- Why it matters: This is the first concrete carry-forward step from waiting-room UI into downstream activity entry, proving the migration path without yet introducing a server-backed participant registry.
- Evidence: `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/activity.config.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`
- Follow-up action: Extend the same handoff to more activities or replace it with a shared server-backed participant-entry contract once `participantId` issuance and reconnect semantics are designed.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activities
- Discovery: Live-session waiting-room carry-forward is no longer limited to raw browser storage. `WaitingRoom` now posts live-entry values to a temporary server-backed session handoff store, keeps only an opaque token in sessionStorage, and `java-string-practice` / `java-format-practice` consume `displayName` through that token-backed path on startup.
- Why it matters: This is the first real move from “client sessionStorage is the handoff system” toward a shared server-backed participant-entry contract, while still keeping the migration surface narrow enough for the already-adopted activities.
- Evidence: `server/core/sessionEntryParticipants.ts`; `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Decide whether the next participant-context step should extend the same handoff beyond `displayName` or pivot to shared `participantId` acceptance/reconnect before broadening activity adoption.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Persistent permalink `continue-solo` now uses the same broad opaque-token handoff pattern as live entry. `WaitingRoom` posts solo preflight values to new persistent-session entry-participant routes, stores only the returned token plus `persistentHash` in sessionStorage, and `entryParticipantStorage` can consume that token later for solo startup while still falling back to local values if the server-backed write fails.
- Why it matters: This removes the previous asymmetry where live entry had early shared `participantId` and server-backed carry-forward but solo permalink continuation still depended entirely on client-held values. The branch now has one reusable token-based handoff shape for both live and persistent-solo waiting-room exits without collapsing the entrypoints themselves.
- Evidence: `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Follow-up action: Decide whether standalone `/solo/:activityId` should eventually consume the same server-backed participant context, or remain a lighter compatibility path outside persistent permalink entry.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: Persistent entry-participant handoff storage now enforces the same bounds as live-session handoff: a max of 100 tokens per persistent session, an 8KB serialized payload limit, and prune-oldest behavior when capacity is exceeded. Oversized payloads surface as typed `413` errors from the persistent entry-participant POST route.
- Why it matters: This closes an unbounded metadata-growth path on persistent permalink flows and keeps live/persistent handoff behavior aligned under abuse or accidental oversized payloads.
- Evidence: `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: If limits change, update both live-session and persistent-session entry-participant modules together to preserve parity.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities
- Discovery: The already-migrated Java activities now share one client-side post-handoff identity helper in `entryParticipantIdentityUtils.ts`. That helper consumes waiting-room handoff values, prefers existing session-local identity when present, persists accepted preflight identity into local storage for reconnect, and avoids `java-format-practice` minting a one-off client-generated participant ID during manual name submit.
- Why it matters: This does not finish the cross-activity participant contract, but it does tighten the current “after handoff, before websocket” behavior into one reusable rule for the migrated activities. It makes the remaining gap clearer: the branch now lacks a shared server-accepted participant contract, not a shared client hydration pattern.
- Evidence: `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/entryParticipantIdentityUtils.test.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Reuse this helper for any additional activities that adopt waiting-room identity before the server-side accepted-entry contract is finalized, and replace it later if a broader shared participant bootstrap flow becomes authoritative.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activities
- Discovery: The Java activities now support ID-only rejoin. The shared `connectAcceptedSessionParticipant()` service can reuse an existing participant's stored name when reconnecting by `participantId`, and `resolveInitialEntryParticipantIdentity()` now treats a persisted session `studentId` as sufficient to skip the duplicate name gate while reconnect state hydrates.
- Why it matters: Rejoin no longer depends on the browser retaining both the display name and the ID. If local name storage is cleared but the server-issued `participantId` remains, the Java activities can still reconnect through the shared participant contract instead of prompting again.
- Evidence: `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/entryParticipantIdentityUtils.test.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Apply the same “ID-only rejoin is sufficient” rule to later activities that adopt the shared accepted-entry connect service, and move the actual session-scoped reconnect identity persistence into the shared entry layer so activities stop owning the timing of `student-name-*` / `student-id-*` writes.
- Owner: Codex

- Date: 2026-03-14
- Area: client | shared entry
- Discovery: Session-scoped reconnect identity now has a dedicated shared client store in `sessionParticipantContext.ts`. The Java activities no longer need their own continuous persistence effect; they read identity through `entryParticipantIdentityUtils` and refresh the shared context only when the server confirms a `studentId`.
- Why it matters: This is the first concrete move from “every activity owns its own local reconnect keys” toward “shared entry code owns the reusable participant context shape.” It narrows the next migration step to expanding the authoritative write path, not inventing another per-activity workaround.
- Evidence: `client/src/components/common/sessionParticipantContext.ts`; `client/src/components/common/sessionParticipantContext.test.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Shift more of the authoritative write timing into shared entry acceptance itself, then migrate the remaining activities off direct `student-name-*` / `student-id-*` reads.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities
- Discovery: `python-list-practice` now opts into the shared waiting-room `displayName` field and resolves initial student identity through `resolveInitialEntryParticipantIdentity(...)` instead of bootstrapping from activity-local `python-list-practice-name-*` / `python-list-practice-id-*` keys.
- Why it matters: The activity now matches the same name-capture and reconnect-entry model already used by the Java practice activities. Waiting-room name collection can carry through directly, while Python List Practice still keeps its own activity-specific stats storage and runtime UI.
- Evidence: `activities/python-list-practice/activity.config.ts`; `activities/python-list-practice/client/student/PythonListPractice.tsx`; `client/src/components/common/entryParticipantIdentityUtils.ts`
- Follow-up action: Keep Python List Practice on the shared entry identity path and avoid reintroducing activity-local bootstrap keys if its runtime flow changes again.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities
- Discovery: `traveling-salesman` now also opts into the shared waiting-room `displayName` field and resolves initial student identity through `resolveInitialEntryParticipantIdentity(...)` instead of relying on its own local name bootstrap.
- Why it matters: This brings another session-backed activity onto the same shared name-capture and reconnect-entry path as the Java and Python practice activities, while still leaving route-building, leaderboard, and map state activity-owned.
- Evidence: `activities/traveling-salesman/activity.config.ts`; `activities/traveling-salesman/client/student/TSPStudent.tsx`; `client/src/components/common/entryParticipantIdentityUtils.ts`
- Follow-up action: Keep TSP on the shared entry identity path and avoid reintroducing an activity-local name gate if its reconnect flow is refined later.
- Owner: Codex

- Date: 2026-03-14
- Area: client | permalink entry
- Discovery: `solo-allowed` permalinks should stay on the waiting room when no live session is active instead of auto-redirecting immediately to `/solo/...`.
- Why it matters: The waiting room is the only shared surface where both sides of the “live or solo” choice are available at once: students can continue solo, while instructors without a remembered cookie still need the teacher-code form to start a live session. Auto-redirecting to solo makes that teacher-start path unreachable.
- Evidence: `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/WaitingRoom.tsx`
- Follow-up action: Keep `continue-solo` as a waiting-room state for permalink entry and only navigate to `/solo/...` after the student explicitly chooses that action.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: The `live/solo` permalink waiting-room flow is now the clearest first browser-level test candidate if the repo adds Playwright later, but the current seam-heavy client coverage is still good enough to ship fixes without adding that harness immediately.
- Why it matters: Recent regressions in this flow came from mounted-screen transitions across permalink entry state, teacher auth, websocket lifecycle, and same-browser role reuse. The helper seams were still sufficient to fix them, but this path now represents the highest-value place to spend a future browser-harness budget.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/waitingRoomSocketUtils.test.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.test.ts`; `client/src/components/common/waitingRoomTransitionUtils.test.ts`
- Follow-up action: If Playwright is introduced, make this flow one of the first scenarios and keep the existing seam tests as the fast inner loop rather than replacing them.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities
- Discovery: Extra one-off routes now belong in top-level `utilities`, not under `manageDashboard`. Utilities can declare their own action (`copy-url` or `go-to-url`) and surfaces (`manage`, `home`), which lets Gallery Walk expose separate dashboard-copy and home-navigation entries without overloading standalone-entry semantics.
- Why it matters: This separates “supports standalone entry” from “needs a special-purpose tool.” It keeps permalink generation as the main student entry surface while still surfacing exceptional activity-owned routes honestly across shared UI surfaces.
- Evidence: `client/src/components/common/ManageDashboard.tsx`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `activities/gallery-walk/activity.config.ts`; `types/activity.ts`
- Follow-up action: Use top-level `utilities` for future activity-specific tools instead of reviving special solo-link buttons or nesting cross-surface utility concerns under `manageDashboard`.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activity config
- Discovery: Standalone capability now splits across direct `/solo/:activityId` support, standalone-capable permalinks, and home-page discovery. The `standaloneEntry` config captures those dimensions directly.
- Why it matters: This lets SyncDeck support standalone via permalink without being forced onto `/solo/syncdeck`, and lets Gallery Walk stay a home-page utility without pretending it supports standalone permalinks.
- Evidence: `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `server/activities/activityRegistry.ts`; `activities/syncdeck/activity.config.ts`; `activities/gallery-walk/activity.config.ts`
- Follow-up action: Keep new activities on explicit `standaloneEntry` declarations and use that shape as the only source of truth for standalone behavior.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now also exposes shared accepted-participant lookup via `findSessionParticipant(...)`, and the migrated Java activity progress endpoints use it instead of route-local `find(...)` logic.
- Why it matters: This extends the shared participant contract one step past websocket join. Waiting-room-issued or reconnected `participantId` is now the first lookup key for later progress updates too, while legacy name-only fallback remains explicitly opt-in for older sessions.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`
- Follow-up action: Reuse the same helper anywhere post-entry activity routes need to resolve an already-accepted participant, and only keep name fallback where backward compatibility with older unnamed records is still necessary. When more routes need to mutate accepted participants, prefer the shared update helper over open-coding lookup plus `lastSeen` mutations.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Shared participant handling now extends beyond lookup into later accepted-participant state updates. `updateSessionParticipant(...)` in `server/core/sessionParticipants.ts` is now used for Java progress updates plus traveling-salesman disconnect/route-submission paths, so those routes all touch `lastSeen` and resolve participants through the same post-handoff rules.
- Why it matters: This pushes the shared participant contract further past entry and reconnect. More of the “already accepted participant” lifecycle now uses one helper instead of each activity route choosing its own lookup/update semantics.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`
- Follow-up action: Keep moving remaining post-entry mutation routes onto this helper where it fits, but stop short of forcing activities with different participant models onto it until the broader accepted-entry service is designed.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now also has a dedicated disconnect helper, and the same shared participant-read helper is used in traveling-salesman’s algorithm broadcast selection. The shared participant contract now spans reconnect/create, accepted lookup, later mutation, and disconnect handling for the current shared-path activities.
- Why it matters: This reduces more route-local participant boilerplate and makes the remaining gap easier to see: we no longer mainly need more helper extraction in these activities, we need a broader accepted-entry service boundary for activities that still live outside this shared path.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`; `activities/traveling-salesman/server/routes/algorithms.ts`
- Follow-up action: Prefer these shared helpers for any further post-entry participant reads/mutations inside the current shared-path activities, and spend future design effort on the cross-activity accepted-entry contract rather than more route-local cleanup.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Duplicate student-socket eviction now also lives in shared server code. `server/core/participantSockets.ts` centralizes the “same session + same participant ID replaces older socket” rule, and the Java routes, traveling-salesman, and SyncDeck websocket student path now delegate to it.
- Why it matters: This keeps one more part of the accepted-participant lifecycle aligned across the activities already on the shared path. The same participant ID now implies the same duplicate-connection replacement behavior without each route carrying its own close-loop implementation, even in SyncDeck where broader registration/reconnect semantics are still activity-owned.
- Evidence: `server/core/participantSockets.ts`; `server/participantSockets.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Reuse this helper anywhere session-bound participant sockets should be single-owner by `participantId`, and avoid reintroducing route-local duplicate-close loops unless an activity genuinely needs a different replacement policy.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: SyncDeck student websocket reconnect now also uses an activity-owned participant helper instead of route-local `students.find(...)` mutation, and the websocket path no longer accepts client-invented IDs. Students must reconnect with a previously registered server-issued `studentId`, while stale cached IDs are treated as reconnect failures.
- Why it matters: This tightens SyncDeck back toward the intended “server-issued participant identity” model without forcing its broader presentation/embed registration flow into the shared waiting-room contract yet. The remaining gap is narrower now: SyncDeck still owns REST registration and instructor/embed authority, but its websocket participant touch path no longer has to drift separately or silently trust arbitrary client IDs.
- Evidence: `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep SyncDeck’s broader embedded-role and registration decisions on the presentation track, but reuse this helper path if more websocket-side participant mutation is needed before that larger design lands.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities | testing
- Discovery: SyncDeck’s stale-student-ID recovery is now isolated behind a tiny client helper rather than living only inside the full student component close handler.
- Why it matters: This gives the branch a direct test seam for the newer “server-issued IDs only” contract on the client side. We can verify that stale cached SyncDeck identity clears local registration and requires rejoin without needing a full browser-style websocket harness.
- Evidence: `activities/syncdeck/client/student/reconnectUtils.ts`; `activities/syncdeck/client/student/reconnectUtils.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: If SyncDeck’s reconnect UX changes again, update the helper and its tests first, then keep the student component wiring thin.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: SyncDeck now has a first runtime surface for embedded role inheritance, even though no embedded child launcher consumes it yet. `POST /api/syncdeck/:sessionId/embedded-context` can validate inherited teacher role from instructor passcode or inherited student role from a registered parent-session student ID.
- Why it matters: This converts the embedded-role plan from pure design text into a concrete server proof surface. The remaining work is now more specific: wire child launch/entry to this validated parent context instead of inventing teacher/student role in the embedded child from scratch.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: When the embedded child-launch path is implemented, use this endpoint plus the matching client helper in `activities/syncdeck/client/shared/embeddedContextUtils.ts` as the parent-context authority rather than trusting client-claimed inherited role or re-deriving passcode/student identity ad hoc.
- Owner: Codex

- Date: 2026-03-14
- Area: activities | server
- Discovery: Python List Practice is no longer fully outside the shared participant contract on the server side. Its websocket join, stats updates, disconnect handling, and normalized stored student records now use shared-style participant IDs and activity-owned wrappers around the common session participant helpers, and the student client now accepts a server-issued `studentId` message.
- Why it matters: This closes one of the explicit remaining gaps from the plan without forcing a waiting-room UI migration for the activity. Python List Practice can now participate in the same broader participant-ID/reconnect direction as the Java and traveling-salesman activities, while still keeping its own activity-specific UI flow for now.
- Evidence: `activities/python-list-practice/server/studentParticipants.ts`; `activities/python-list-practice/server/studentParticipants.test.ts`; `activities/python-list-practice/server/routes.ts`; `activities/python-list-practice/client/student/PythonListPractice.tsx`
- Follow-up action: If Python List Practice later adopts waiting-room entry, reuse the existing shared participant path instead of introducing another activity-local server identity lifecycle.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activities
- Discovery: The live entry-participant handoff now mints shared `participantId` before activity-specific websocket join. `java-string-practice` and `java-format-practice` can carry that ID into their first live-session websocket URL instead of waiting for the activity route to assign and echo a new one after connection.
- Why it matters: This is the first shared path where participant identity exists before activity-specific join logic runs, which narrows the gap between “waiting-room accepted entry” and “activity-owned participant registration” without yet forcing every activity onto one registration service.
- Evidence: `server/core/sessionEntryParticipants.ts`; `server/core/participantIds.ts`; `client/src/components/common/entryParticipantStorage.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Extend the same accepted-entry `participantId` model to more activities only after deciding whether shared reconnect semantics or a unified registration endpoint is the next abstraction boundary.
- Owner: Codex

- Date: 2026-03-13
- Area: client | activities
- Discovery: `consumeEntryParticipantDisplayName(...)` now gives activities one shared way to read waiting-room `displayName` handoff data for either live-session or solo entry, and `java-format-practice` is the second activity to adopt it.
- Why it matters: This reduces migration copy-paste and proves the handoff model works for both `session` and `solo` destinations before a server-backed participant context exists.
- Evidence: `client/src/components/common/entryParticipantStorage.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/activity.config.ts`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Keep later activity migrations using the shared helper instead of re-implementing storage-key logic, and replace the helper with a server-backed lookup once participant entry is centralized.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: `WaitingRoom` is no longer hard-coded as a teacher-wait blocker. It now accepts the resolved entry outcome so `continue-solo` permalink flows with waiting-room fields can render a solo-preflight screen and CTA instead of incorrectly telling the user to wait for a teacher.
- Why it matters: Without outcome-aware presentation, future activities that add waiting-room fields would regress on `solo-allowed` or `solo-only` permalinks by showing misleading copy and the wrong primary action even though the router had already resolved a solo destination.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomViewUtils.ts`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: Extend the same outcome-aware waiting-room shell when preflight data starts flowing into downstream activity entry so the primary CTA can hand off validated participant data rather than only local sessionStorage state.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Persistent permalink entry resolution now lives in shared client utility logic (`resolvePersistentSessionEntryOutcome`) so `SessionRouter` can treat `solo-only` and `solo-allowed` links consistently across started-session, teacher-cookie, and solo-support cases.
- Why it matters: This prevents regressions where a remembered teacher cookie or an already-started managed session accidentally overrides `solo-only` behavior, and it gives later Phase 3 work one place to extend instead of scattering policy branches through route components.
- Evidence: `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`
- Follow-up action: Reuse the resolver shape when ad-hoc join-code entry is folded into the same waiting-room gateway, and expand it to account for waiting-room preflight state once participant-data carry-forward lands.
- Owner: Codex

- Date: 2026-03-14
- Area: client
- Discovery: Standalone permalink entry resolution now has one shared decision shape for role, destination, and presentation mode, and `SessionRouter` uses that decision to pass student `join-live` permalinks straight into the running session when no waiting-room fields are required.
- Why it matters: This removes one more special-case permalink branch, codifies the plan's “student by default, teacher only via auth intent, `solo-only` stays solo” rule, and keeps role/presentation decisions in one place before the later server-backed gateway work.
- Evidence: `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`; `client/src/components/common/SessionRouter.tsx`; `.agent/plans/waiting-room-expansion.md`; `.agent/knowledge/data-contracts.md`
- Follow-up action: Expand the same decision model to join-code and embedded entry once those flows stop bypassing the shared resolver and can carry parent role or server-issued participant context.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Waiting-room custom fields now reuse the owning activity's existing lazy-loaded client entry bundle via `loadActivityWaitingRoomFields(...)` instead of introducing a second discovery/bundling path.
- Why it matters: This keeps waiting-room customization aligned with the current activity loader, avoids parallel registry complexity, and lets shared waiting-room UI fail safely with a loading or unavailable message when a custom field component cannot be resolved.
- Evidence: `client/src/activities/index.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomFieldUtils.ts`
- Follow-up action: When an activity adopts `waitingRoom.fields` with `type: 'custom'`, export the matching component from its client entry `waitingRoomFields` map rather than adding shared-module conditionals.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck presentation URLs must be scheme-compatible with the ActiveBits host page. When ActiveBits is loaded over HTTPS, configuring or joining a SyncDeck session with an `http://...` presentation URL causes mixed-content blocking, the iframe stays on an `about:blank` parent-origin window, and subsequent `postMessage(..., "http://...")` calls fail in the student view.
- Why it matters: The symptom can look like a `postMessage` protocol bug, but the root cause is browser mixed-content policy. SyncDeck client validation now blocks that configuration early and shows an explicit error instead of trying to sync a blocked iframe.
- Evidence: `activities/syncdeck/client/shared/presentationUrlCompatibility.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/syncdeck/client/shared/presentationUrlCompatibility.test.ts`
- Follow-up action: For local deck testing from production/staging ActiveBits, prefer an HTTPS dev tunnel or host the presentation over HTTPS. Loopback URLs such as `http://127.0.0.1` may work from `https://...` ActiveBits pages in Chromium-based browsers, but Safari blocks them, and non-loopback HTTP origins will still fail mixed-content checks.
- Owner: Codex
- Date: 2026-02-27
- Area: docs
- Discovery: Repository instructions now explicitly require frontend controls to include appropriate accessibility semantics and state attributes, with examples such as `aria-pressed`, `aria-expanded`, accessible names for icon-only controls, and preference for native interactive elements.
- Why it matters: This makes accessibility requirements part of the default implementation standard instead of a per-review afterthought, which should reduce repeated UI fixes across activities and shared client code.
- Evidence: `AGENTS.md`
- Follow-up action: When adding or reviewing frontend controls, check semantics and state exposure alongside behavior and styling.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager/student directional navigation is now host-overlaid on iframe edges (left/right/up/down) and driven by iframe `reveal-sync` `state/ready` payloads (`indices` + `capabilities.canNavigateBack/canNavigateForward`) rather than hardcoded deck assumptions.
- Why it matters: Navigation controls can be reused across decks without per-presentation edits, and student forward controls now disable at the effective sync boundary unless the student has opted out by backtracking.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If reveal iframe protocol expands directional capability flags (`canNavigateLeft/Right/Up/Down`), wire those into button visibility to refine per-axis disable states beyond current back/forward capability fallback.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager instructor updates now relay to other instructors by default, and each manager has a local toolbar sync toggle (`🔗`) that disables both outbound instructor broadcasts and inbound instructor state application while still keeping the connection active for session metadata (for example student presence).
- Why it matters: Multiple instructors stay in lockstep by default, and any instructor can temporarily navigate independently without disrupting student/instructor shared state until they re-enable sync.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If instructors request independent viewing with read-only follow indicators, extend the toggle into explicit sync modes (follow-only, broadcast-only, fully detached) rather than introducing activity-specific behavior in shared modules.
- Owner: Codex

- Date: 2026-02-27
- Area: client
- Discovery: SyncDeck persistent teacher auth from `WaitingRoom` must send `selectedOptions` parsed from the permalink query (including decode-normalized `presentationUrl` for encoded/double-encoded values), and manager passcode hydration should replace invalid current `presentationUrl` state with the validated cookie-backed `persistentPresentationUrl`.
- Why it matters: Without `selectedOptions` in waiting-room auth, the refreshed `persistent_sessions` cookie loses `presentationUrl/urlHash`, making `/api/syncdeck/:sessionId/instructor-passcode` return null recovery fields; if query bootstrap is percent-encoded, manager state can remain invalid and block configure/start.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Remove temporary `[SYNCDECK-DEBUG]` logs after confirming production traces show decoded `selectedOptions.presentationUrl` and non-null `persistentPresentationUrl/persistentUrlHash` through waiting-room teacher startup.
- Owner: Codex

- Date: 2026-02-26
- Area: activities
- Discovery: SyncDeck `instructor-passcode` recovery for persistent sessions must normalize `selectedOptions.presentationUrl` from the cookie (including iterative `decodeURIComponent` fallback with up to 3 decode attempts when the stored value is percent-encoded) and recompute `urlHash` from the persistent hash when the cookie entry is missing `urlHash`.
- Why it matters: In the persistent-session teacher flow, the generic `persistent-session/authenticate` cookie rewrite can preserve or seed a cookie entry that lacks SyncDeck's `urlHash`, and encoded `presentationUrl` values fail URL validation, causing the manager to stall on the configure screen instead of auto-starting the presentation.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/:sessionId/instructor-passcode`); `activities/syncdeck/server/routes.test.ts` (encoded cookie URL + missing `urlHash` regression)
- Follow-up action: Investigate the upstream source of percent-encoded `presentationUrl` values entering persistent cookies (likely a double-encoded permalink copy/share path) and consider normalizing URL-validated deep-link options when persisting generic persistent-session auth cookies.
- Owner: Codex

- Date: 2026-02-26
- Area: tooling
- Discovery: GitHub Actions dependency install can intermittently fail during `esbuild` postinstall with `spawnSync .../node_modules/esbuild/bin/esbuild ETXTBSY`; switching CI to `npm ci` and retrying the install step mitigates the runner-side binary write/execute race.
- Why it matters: The failure occurs before tests run and is transient/infrastructure-related, causing flaky CI even when repository code is unchanged.
- Evidence: `.github/workflows/ci.yml` (install step retry loop + `npm ci`); CI error logs showing `node_modules/esbuild/install.js` `ETXTBSY`
- Follow-up action: If flakes continue, capture whether they cluster on a specific runner image and consider pinning npm version or adding a cache cleanup before retries.
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck chalkboard replay buffering now caps `chalkboard.delta` to the most recent 200 stroke commands during both runtime updates and persisted-session normalization.
- Why it matters: Prevents unbounded session-store growth and keeps replay payload size bounded when new instructor/student clients join long-running sessions with heavy drawing activity.
- Evidence: `activities/syncdeck/server/routes.ts` (`MAX_CHALKBOARD_DELTA_STROKES`, `normalizeChalkboardDelta`, `applyChalkboardBufferUpdate`); `activities/syncdeck/server/routes.test.ts`
- Follow-up action: If replay latency remains high in practice, add a size-based cap and/or server-triggered periodic `chalkboardState` snapshot refreshes so stroke deltas reset more aggressively.
- Owner: Codex

- Date: 2026-02-25
- Area: tooling
- Discovery: `client/tsconfig.json` and `activities/tsconfig.json` need `lib` aligned with the repo `ES2022` baseline (plus DOM libs) to avoid client/activity typecheck failures for newer standard APIs like `Array.prototype.at`.
- Why it matters: Mixed lib baselines let the same API typecheck in server/shared contexts (`ES2022`) but fail in client/activity code still using `ES2020` libs, causing inconsistent TS diagnostics during migration work.
- Evidence: `tsconfig.base.json`; `client/tsconfig.json`; `activities/tsconfig.json`
- Follow-up action: Keep workspace `lib` arrays aligned when raising the base TS target/lib to prevent drift between browser and server type environments.
- Owner: Codex

- Date: 2026-02-25
- Area: client
- Discovery: Upgrading `eslint-plugin-react-hooks` to `7.x` adds stricter lint rules (including `react-hooks/refs` and `react-hooks/immutability`) that flag render-time ref reads and callback self-reference patterns previously accepted by the repo.
- Why it matters: Major lint-plugin upgrades can require behavior-preserving code refactors (not just config/package changes) to keep `npm test` green.
- Evidence: `client/src/components/common/StatusDashboard.tsx`; `client/src/hooks/useResilientWebSocket.ts`; `client/package.json`
- Follow-up action: When upgrading React hooks lint tooling, run full lint early and budget time for small hook/ref refactors instead of assuming a lockfile-only change.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` client-side formatter evaluator must support Java hex specifiers (`%x/%X`) because advanced challenge output validation relies on `%04X` in the mission badge clearance line.
- Why it matters: Missing `%x/%X` support leaves tokens like `%04X` uninterpreted in client validation/output previews, causing false negatives in otherwise correct advanced answers.
- Evidence: `activities/java-format-practice/client/utils/formatUtils.ts`; `activities/java-format-practice/client/evaluateFormatString.test.ts`
- Follow-up action: Add evaluator test cases whenever new Java `Formatter` specifiers are introduced in challenge content so challenge migrations cannot silently outpace parser support.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` student difficulty/theme controls must be treated as solo-only; in managed sessions the student view should reflect manager broadcasts but not allow local changes.
- Why it matters: A TypeScript migration regression left the student selector interactive in teacher-managed sessions, allowing students to change session-wide difficulty/theme outside the manage dashboard.
- Evidence: `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `activities/java-format-practice/client/components/basicComponents.test.tsx`
- Follow-up action: When migrating activity student views, explicitly gate session-setting handlers and selector interactivity on `isSoloSession` to avoid reintroducing managed-mode control paths.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `activity.config` files now have a shared runtime parser/schema (`types/activityConfigSchema.ts`) and the server activity registry validates configs during load before filtering/route registration.
- Why it matters: TypeScript annotations on activity configs do not protect runtime-loaded `.js` configs or malformed shared-contract fields; schema validation now fails fast in production with a config-path-specific error.
- Evidence: `types/activityConfigSchema.ts`; `server/activities/activityRegistry.ts`; `server/activityConfigSchema.test.ts`; `server/activities/activityRegistry.test.ts`
- Follow-up action: Consider reusing the same parser in `client/src/activities/index.ts` so the dashboard/client registry warns and skips invalid configs consistently in the browser build path too.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: Shared `ManageDashboard` now supports a generic `createSessionBootstrap.sessionStorage[]` activity-config contract for persisting create-session response fields (for example SyncDeck `instructorPasscode`) without activity-specific conditionals in shared code.
- Why it matters: Preserves the Activity Containment Boundary by keeping shared dashboard logic activity-agnostic while still allowing activities to bootstrap manager-only client state from create responses.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`
- Follow-up action: Reuse this contract for future activities that need post-create client bootstrap values, and extend the contract (rather than branching in shared UI) if new storage targets are needed.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `resolvePersistentSessionSecret()` now memoizes the first successfully resolved value for the process, so later calls return the same secret and do not repeat warning side effects.
- Why it matters: Multiple modules import persistent-session helpers at module init (including activity routes), and without memoization non-production warnings can duplicate while test/runtime env mutations could produce inconsistent HMAC secrets across call sites.
- Evidence: `server/core/persistentSessions.ts`; `server/persistentSessionsSecret.test.ts`
- Follow-up action: If future tests need to exercise multiple resolver scenarios in one process, continue using cache-busting dynamic imports (or add a test-only reset helper rather than mutating global process env mid-module).
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck persistent-link cookie entries must persist the signed `urlHash` alongside `presentationUrl` (or equivalent full query params), because the generic dashboard list/CSV/copy flow reconstructs share links from cookie `selectedOptions`.
- Why it matters: If only `presentationUrl` is stored, previously created SyncDeck links copied/exported from `/manage` lose `urlHash`, causing tamper-protection bypass/failure and broken links.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/generate-url` cookie write); `server/routes/persistentSessionRoutes.ts` (`/api/persistent-session/list` returns cookie `selectedOptions`); `client/src/components/common/ManageDashboard.tsx` + `client/src/components/common/manageDashboardUtils.ts` (copy/CSV append query from `selectedOptions`)
- Follow-up action: Keep signed/generated query params in sync with any future SyncDeck deep-link integrity fields and add migration handling if cookie entry shape changes again.
- Owner: Codex

- Date: 2026-03-14
- Area: persistent sessions
- Discovery: Generic persistent links now carry signed URL state for permalink meaning too. `POST /api/persistent-session/create` returns `entryPolicy` plus a short `urlHash` in the permalink query, teacher cookies preserve that same signed state for dashboard reconstruction, and generic permalink metadata/entry/auth routes now trust verified URL state before falling back to the compatibility default `Live Only`.
- Why it matters: Local/dev servers do not have durable persistent-session metadata. Without self-describing signed URL state, restarted servers silently forget `solo-allowed` / `solo-only` and revert to `instructor-required` because the opaque hash alone does not encode `entryPolicy`.
- Evidence: `server/core/persistentLinkUrlState.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/manageDashboardUtils.ts`
- Follow-up action: Keep future generic permalink control params inside the signed query contract instead of adding unsigned meaning-bearing params beside the hash.
- Owner: Codex

- Date: 2026-02-23
- Area: tooling
- Discovery: Upgrading `client`/`server` to `eslint@10` is currently blocked by `eslint-plugin-react-hooks`. The latest published `eslint-plugin-react-hooks@7.0.1` still declares a peer dependency range that supports ESLint up to `^9.0.0`, so `npm install` fails with `ERESOLVE` before lint can run.
- Why it matters: Future dependency update attempts may incorrectly assume ESLint 10 is ready because `npm outdated` shows newer `eslint` and `@eslint/js` versions. This saves time and avoids forced installs on the main branch.
- Evidence: `client/package.json`; `server/package.json`; `npm install --include=dev --workspaces --include-workspace-root` (ERESOLVE peer conflict); `npm view eslint-plugin-react-hooks@latest version peerDependencies --json`
- Follow-up action: Re-check `eslint-plugin-react-hooks` peer support for ESLint 10 on the next dependency refresh, then retry the ESLint 10 bump in a separate commit.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` is currently UI/query metadata only; the generic permanent-link flow appends selected options as query params and does not cryptographically bind them. A safer extension path is to keep the shared modal UX in `ManageDashboard` but allow an activity-configured deep-link generator endpoint to return the authoritative URL.
- Why it matters: Activities that require integrity-protected deep-link params (for example SyncDeck `presentationUrl` + `urlHash`) should not rely on unsigned query strings from the generic create route.
- Evidence: `activities/algorithm-demo/activity.config.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `server/routes/persistentSessionRoutes.ts`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: Implement optional `deepLinkGenerator` in `ActivityConfig`, branch `ManageDashboard` create-link calls to that endpoint when configured, and keep legacy `/api/persistent-session/create` behavior as fallback.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` now supports an explicit per-field validator contract (`validator: 'url'`) that is parsed by dashboard utilities and enforced in ManageDashboard modals with inline field errors and disabled actions.
- Why it matters: Activity configs can require valid URL inputs before link creation/copy/open actions, reducing malformed deep-link generation and improving teacher feedback in the modal UX.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `npm --workspace client test`
- Follow-up action: Reuse `validator: 'url'` for any future deep-link text fields that represent external links; add additional validator types only when there is a concrete activity need.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: SyncDeck now validates `presentationUrl` format in both deep-link generation (`/api/syncdeck/generate-url`) and runtime configure (`/api/syncdeck/:sessionId/configure`) so the configure path no longer accepts non-http(s) URLs.
- Why it matters: Prevents bypass where malformed or unsafe URLs could be injected at configure time even if deep-link generation validates correctly.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `npm --workspace activities run test:activity --activity=syncdeck`; `npm test`
- Follow-up action: Keep validation helpers aligned if URL policy is tightened (for example hostname allowlists), and mirror policy in both generation and configure endpoints.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: SyncDeck student sync requires translating iframe-origin `reveal-sync` `action: "state"` messages into plugin-compatible host commands (`action: "command"`, `payload.name: "setState"`) before posting into the student iframe.
- Why it matters: Forwarding raw state envelopes does not reliably apply navigation in the custom `reveal-iframe-sync` plugin contract; command-form messages are the stable host→iframe control surface.
- Evidence: `.agent/plans/reveal-iframe-sync-message-schema.md`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: Keep all new SyncDeck relay commands aligned to the schema doc and add explicit tests when introducing additional command names beyond `setState`.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: In SyncDeck manager, websocket URL builders passed to `useResilientWebSocket` must be memoized (`useCallback`) to prevent reconnect churn and visible status-dot flicker.
- Why it matters: Recreated URL builder functions can trigger repeated connect/disconnect cycles, which can interrupt message relay and make connection state indicators unstable.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx` (`buildInstructorWsUrl` + indicator debounce); observed red/green flashing resolved after memoization.
- Follow-up action: For future activities using `useResilientWebSocket`, memoize `buildUrl` callbacks and debounce transient disconnected indicators in UI status elements.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: Persistent-session HMAC secret validation is now strict in production. `PERSISTENT_SESSION_SECRET` must be present, at least 32 characters, and not in the weak/default denylist; otherwise process startup throws.
- Why it matters: Prevents running production with a known/default key that would allow forged persistent hashes and offline teacher-code guessing against HMAC-derived link checks.
- Evidence: `server/core/persistentSessions.ts` (`resolvePersistentSessionSecret`); `activities/syncdeck/server/routes.ts` (SyncDeck urlHash now uses shared resolver).
- Follow-up action: Ensure deployment environments set a strong random secret before rollout; keep test/dev environments on non-production mode unless intentionally validating startup failures.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: `ManageDashboard` now supports an activity-owned persistent-link builder UI slot via client-module export (`PersistentLinkBuilderComponent`), gated by `activity.config.manageDashboard.customPersistentLinkBuilder`, while generic activities continue using shared `deepLinkOptions` form handling.
- Why it matters: Keeps shared dashboard code activity-agnostic and moves complex preflight/protocol-specific permalink UX (like SyncDeck reveal-sync validation/preview) into the owning activity without losing a standardized modal placement.
- Evidence: `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/index.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`
- Follow-up action: Focus future changes on evolving `ActivityPersistentLinkBuilderProps` (only if multiple activities need more shared callbacks/state) rather than adding protocol-specific branches back into `ManageDashboard`.
- Owner: Codex

- Date: 2026-03-14
- Area: client | persistent sessions
- Discovery: `ManageDashboard` permalink rows now support shared remove and edit actions. Remove uses a left-side `×` action that forgets the permalink from the teacher cookie and cleans current runtime metadata; edit opens the shared permalink modal with existing `selectedOptions` + `entryPolicy` preloaded and rewrites the signed permalink URL for the same hash.
- Why it matters: Instructors can now maintain old permalinks without hand-editing cookies or recreating entirely new hashes just to adjust entry mode or deep-link options.
- Evidence: `client/src/components/common/ManageDashboard.tsx`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: Temporary compatibility path: edits currently force the shared form even for activities that have a create-only `PersistentLinkBuilderComponent`. If activity-owned builders later need custom edit UX, extend the shared builder props contract instead of adding more one-off shared branches.
- Owner: Codex

- Date: 2026-02-26
- Area: client
- Discovery: Shared HTTP(S) URL validation used by `ManageDashboard` deep-link parsing and `SessionRouter` teacher redirect parsing now lives in `client/src/components/common/urlValidationUtils.ts` (`isValidHttpUrl`), and `SessionRouter`'s async manage-path resolver is memoized with `useCallback` so `react-hooks/exhaustive-deps` can include it without warnings.
- Why it matters: Prevents duplicate URL-policy drift across client parsers and keeps hook dependency arrays both correct and lint-clean when async helpers are referenced from effects.
- Evidence: `client/src/components/common/urlValidationUtils.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Reuse `urlValidationUtils.ts` for future client-side URL validation instead of re-implementing `new URL(...)` checks in feature files.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck index extraction now accepts `reveal-sync` `action: "ready"` envelopes in both manager and student clients, not only `state`, so first-message index snapshots are retained.
- Why it matters: Some decks publish navigation indices in the initial ready handshake, so keeping the parsers action-tolerant preserves first-message state if host-side navigation or diagnostics are reintroduced later.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep reveal-sync parsing helpers action-tolerant when payload schema matches, and add tests whenever new actions can carry `indices`.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore conversion now treats restorable `reveal-sync` `ready` envelopes like `state` by translating `indices` or `navigation.current` into a `command/setState` restore before restore suppression is armed.
- Why it matters: Without this alignment, a `ready` message could contribute indices to suppression tracking while being posted back to the iframe unchanged, causing outbound state to be dropped until timeout with no actual restore applied.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep `extractIndicesFromRevealPayload()` and `buildRestoreCommandFromPayload()` behavior in sync whenever new inbound reveal actions become restorable.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer relays outbound `reveal-sync` `ready` envelopes to the sync server; only meaningful state-bearing updates should drive cross-instructor synchronization.
- Why it matters: Initial iframe `ready` messages often report default indices before a pending restore is applied, and broadcasting them can make peer instructors jump backward by restoring from stale startup coordinates.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.ts`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.test.ts`
- Follow-up action: If a future multi-instructor feature genuinely needs `ready` propagation, add an explicit opt-in relay path instead of falling back to generic outbound state relay.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck no longer exports unused `extractNavigationCapabilities()` helpers from the manager or student clients; dormant host-navigation parsing was removed because the shipped shells do not render overlay arrow controls that consume those values.
- Why it matters: Keeps the SyncDeck client modules aligned with actual runtime behavior, removes duplicated parser code, and avoids implying a supported host-navigation API surface that is not part of the shipped UI.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If host-side navigation returns, reintroduce protocol parsing only alongside a real runtime consumer and keep the implementation shared instead of duplicating manager/student helpers.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer exports the unused `buildDirectionalSlideIndices()` helper or its direction type; those test-only artifacts were removed because the host shell does not ship directional navigation controls.
- Why it matters: Keeps the production module surface aligned with actual runtime behavior and avoids implying a supported host-navigation API that the manager does not use.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If host-side directional navigation returns, add the helper back only alongside a real runtime caller rather than exporting test-only code from the manager module.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck student no longer exports the unused `isForwardNavigationLocked()` helper; forward-lock calculation remained only in unit tests after student forward-lock UI was left out of the shipped shell.
- Why it matters: Keeps `SyncDeckStudent.tsx` focused on active runtime behavior and avoids preserving a dead API surface that suggests the student shell currently enforces host-side forward-lock UI.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If student forward-lock UI returns, add the calculation back alongside a real runtime caller rather than exporting it solely for tests.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore suppression now drops the first outbound `reveal-sync` `state` emitted when an inbound restore reaches target indices, then releases suppression.
- Why it matters: Prevents instructor-to-instructor echo loops where a relayed inbound state triggers a local `setState` restore, then re-broadcasts that same state back through the server.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Reuse `evaluateRestoreSuppressionForOutboundState` if additional restore paths are added so echo prevention remains consistent.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck host-side iframe overlay arrow controls were removed from both manager and student shells; navigation is now expected to use presentation-native controls inside the deck.
- Why it matters: Avoids duplicate/competing navigation UI at the host layer and removes schema-coupled host arrow-state complexity.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep host shell focused on sync/session controls; add navigation affordances in deck content/plugins if needed.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: Video Sync manager auth now follows the same session-scoped instructor passcode pattern as SyncDeck: temporary sessions return an `instructorPasscode` captured via `createSessionBootstrap`, manager websocket/config/command routes require that passcode, and persistent permalink sessions recover it through a teacher-cookie-validated `/api/video-sync/:sessionId/instructor-passcode` route instead of trusting `role=manager`.
- Why it matters: Manager authority is now derived from server-issued session credentials plus persistent-session teacher-cookie validation, so students cannot self-upgrade by picking `role=manager` or calling manager HTTP endpoints with only a `sessionId`.
- Evidence: `activities/video-sync/activity.config.ts`; `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: If Video Sync later needs finer-grained multi-manager entry, layer it on top of the same instructor-passcode/session bootstrap contract rather than reintroducing client-declared manager roles.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck released-stack boundary comparisons must treat same-horizontal vertical child-slide movement as still inside the released region; only moving to a later horizontal slide should clear/supersede the explicit boundary, and student snapback logic must not pull `h`-matching lower child slides back to `v = 0`.
- Why it matters: Full `h/v/f` boundary comparisons caused manager relay logic to clear boundaries and student boundary sync to snap lower-stack students back to the top child when an instructor moved down and back up within an already released vertical stack.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: When adjusting SyncDeck release logic, keep reconnect boundary restoration intact but preserve horizontal-only released-stack semantics for explicit boundary clear/snap decisions.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: Video Sync now uses one manager-authorization boundary across websocket and HTTP surfaces: the same `instructorPasscode` gates `role=manager` websocket connections and the session config/playback command endpoints, while student telemetry events remain open.
- Why it matters: This avoids drifting into partially protected manager behavior where one control surface is secured but another still trusts session possession.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: Keep future manager-only endpoints on the same passcode requirement unless the activity adopts a stronger signed-token/session identity model.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck presentation preflight should accept the iframe's origin-validated `reveal-sync` `ready` startup message as a successful validation signal in addition to `pong`.
- Why it matters: Some regression/manual decks announce `ready` on init but do not answer the host ping with `pong`, and `pong`-only validation incorrectly blocks otherwise compatible SyncDeck presentations.
- Evidence: `activities/syncdeck/client/shared/presentationPreflight.ts`; `activities/syncdeck/client/shared/presentationPreflight.test.ts`
- Follow-up action: Keep preflight strict on `origin`/`source`, but treat standard startup handshake messages as sufficient proof that the reveal-sync bridge is alive.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck host/student boundary canonicalization now uses the documented end-of-slide sentinel `f: -1` and boundary-specific comparison helpers instead of `Number.MAX_SAFE_INTEGER`.
- Why it matters: The old sentinel leaked an internal comparison hack into boundary payloads and drifted from the reveal-sync schema; using `f: -1` keeps wire semantics aligned while still preserving “end of boundary slide” behavior in suppression and snapback logic.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If the iframe starts exposing explicit fragment-count metadata in state payloads, revisit boundary comparison helpers and remove the remaining sentinel semantics entirely.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck now treats `syncToInstructor` as the host-side “snap to instructor and resume follow mode” command; explicit boundary relays remain `setStudentBoundary`, but host-generated snapback paths no longer send deprecated `syncToBoundary` flags on boundary commands.
- Why it matters: This keeps SyncDeck aligned with the updated reveal-sync protocol, avoids using boundary-setting commands as a hidden force-sync mechanism, and prevents duplicate `setState` relays when the student iframe can apply the instructor sync atomically in one command.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`
- Follow-up action: Keep future SyncDeck host relay changes split between explicit boundary grants (`setStudentBoundary`), boundary clears (`clearBoundary`), and explicit user-driven snap commands (`syncToInstructor`) instead of inferring snap-to-instructor from ordinary `state` payloads with `studentBoundary: null`.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck now centralizes reveal-sync protocol compatibility assessment (`assessRevealSyncProtocolCompatibility`) and adds opt-in client tracing (`?syncdeckDebug=1` or `localStorage.syncdeck_debug=1`) plus structured server warning telemetry for incompatible protocol envelopes.
- Why it matters: Sync failures caused by message-schema/version drift were previously silent; instrumentation now shows where a payload was queued, relayed, suppressed, or warned for version mismatch without changing normal relay behavior.
- Evidence: `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/shared/revealSyncProtocol.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`
- Follow-up action: If protocol-major enforcement is required later, flip client/server compatibility warnings into explicit drops behind a gated rollout after decks are verified on `2.x`.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck server reveal-sync protocol warning dedupe now uses a bounded in-memory TTL/LRU-style map (5-minute TTL, max 500 keys) instead of an unbounded set.
- Why it matters: Keeps protocol warning spam suppression while preventing unbounded memory growth during long-running sessions with diverse mismatch signatures.
- Evidence: `activities/syncdeck/server/routes.ts`
- Follow-up action: If warning volume increases in production, consider exposing dedupe hit/prune counters via status telemetry.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck manager/student debug tracing refs must be initialized eagerly with `useRef(isSyncDeckDebugEnabled())` instead of `useRef(false)` to capture events that arrive before the first `useEffect` runs.
- Why it matters: Early WebSocket or message-handler traffic can occur between first render commit and effect execution; lazy post-render initialization silently drops `[SYNCDECK-DEBUG]` traces even when `?syncdeckDebug=1` is present.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/shared/syncDebug.test.ts`
- Follow-up action: Keep the existing `location.search` effect update for navigation-time toggles, but preserve eager ref initialization when refactoring trace logging paths.
- Owner: Codex
- Date: 2026-03-13
- Area: tooling
- Discovery: The macOS Docker Desktop devcontainer blocked nested sandbox tooling such as Codex `apply_patch` because the `app` service was running under a seccomp profile that denied `unshare`, even though `kernel.unprivileged_userns_clone = 1` inside the guest. A repo-local namespace-friendly seccomp profile plus `cap_add: [SYS_ADMIN]` was added under `.devcontainer/` to make namespace-based tools work without switching the whole container to `seccomp:unconfined`.
- Why it matters: Devcontainer-based coding agents and other sandboxed helpers can fail with `bwrap: No permissions to create a new namespace` or `unshare ... Operation not permitted` on macOS-backed containers unless the container security profile is loosened.
- Evidence: `.devcontainer/docker-compose.yml`; `.devcontainer/seccomp-namespace.json`; `unshare -Ur true` previously failed with `Operation not permitted` in the `app` container.
- Follow-up action: Rebuild the devcontainer after changing the compose security settings, then re-test namespace creation (`unshare -Ur true`) and Codex `apply_patch` before broadening the profile further.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: Even with the namespace-friendly seccomp profile, Codex sandbox launch can still fail with `bwrap: Failed to make / slave: Permission denied` when the container remains under AppArmor `docker-default (enforce)` and `bubblewrap` is missing.
- Why it matters: This failure occurs before normal command execution and blocks agent automation paths that depend on nested sandboxing.
- Evidence: `bwrap --ro-bind / / true` failed with `Failed to make / slave`; `/proc/self/attr/current` reported `docker-default (enforce)`; devcontainer updates in `.devcontainer/docker-compose.yml` (add `apparmor:unconfined`) and `.devcontainer/devcontainer.json` (install `bubblewrap` in `postCreateCommand`).
- Follow-up action: Rebuild the devcontainer, then verify a non-escalated command path works (for example `echo sandbox-ok`) before continuing feature work.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: After rebuilding with `seccomp:unconfined` and `apparmor:unconfined`, nested sandbox launch is still blocked for the non-root `vscode` user at the user-ID mapping step: `unshare -Ur ...` fails with `write failed /proc/self/uid_map: Operation not permitted`, and `bwrap` fails with `setting up uid map: Permission denied`, while the same `unshare`/`bwrap` commands succeed under `sudo`.
- Why it matters: The remaining blocker is no longer seccomp/AppArmor profile selection inside the container; it is unprivileged user-namespace ID mapping for `vscode`, so additional repo-local seccomp changes will not fix Codex sandbox startup on their own.
- Evidence: `cat /proc/self/attr/current` reported `unconfined`; `/proc/sys/kernel/unprivileged_userns_clone=1`; `/proc/sys/kernel/apparmor_restrict_unprivileged_userns=1`; `strace` showed `openat(..., "uid_map", O_RDWR|O_CLOEXEC) = -1 EACCES`; `sudo unshare -Ur ...` and `sudo bwrap ...` both succeeded; installing `uidmap` added `newuidmap`/`newgidmap` but did not change the non-root `bwrap` failure.
- Follow-up action: Investigate the host or Docker Desktop VM policy that still restricts unprivileged user namespace mapping for container users, or switch the agent path to a root/setuid-capable `bwrap` configuration that is actually honored by the runtime.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: After installing `bubblewrap` in the devcontainer, Codex can execute `bwrap` successfully only with escalated privileges; non-escalated runs still fail (`open /proc/.../ns/ns failed`). A minimal escalated command (`bwrap --ro-bind / / -- bash -lc 'echo BWRAP_MIN_OK'`) succeeds, and Codex `apply_patch` now executes end-to-end successfully.
- Why it matters: This confirms agent workflows are unblocked for privileged command paths, while non-escalated namespace operations remain constrained and should not be assumed to work.
- Evidence: Terminal validation on 2026-03-13: `command -v bwrap` => `/usr/bin/bwrap`; `bwrap --version` => `0.11.0`; non-escalated `bwrap` failed; escalated minimal `bwrap` succeeded; repeated `apply_patch` create/delete smoke tests succeeded.
- Follow-up action: Keep using escalation for `bwrap`-dependent checks in this environment, and prefer `apply_patch` for file edits now that it is stable.
- Owner: Codex

- Date: 2026-03-14
- Area: syncdeck
- Discovery: Declaring SyncDeck’s required `displayName` at the activity-config level is the cleanest way to make waiting-room accepted identity the default path instead of a compatibility bridge.
- Why it matters: That keeps shared waiting-room collection responsible for student naming, lets join-code and permalink flows behave the same way, and reduces the chance that SyncDeck drifts back into “ask again inside the activity” behavior.
- Evidence: `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: The remaining SyncDeck-specific piece is the server-side registration/connect split, not name collection. Future migration work should focus there rather than adding more UI prompts.
- Owner: Codex

- Date: 2026-03-14
- Area: syncdeck
- Discovery: Once SyncDeck declares the waiting-room `displayName` field, the cleanest end state is to remove the pre-connect registration hop entirely. SyncDeck now resolves student identity from waiting-room accepted entry or stored session identity, then connects directly over websocket; the old `register-student` route and client registration helper are gone.
- Why it matters: This makes waiting-room accepted entry authoritative for new SyncDeck student identity and removes the last meaningful compatibility layer from the client flow.
- Evidence: `activities/syncdeck/activity.config.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/entryIdentityUtils.ts`
- Follow-up action: The remaining convergence work is now mostly about reducing SyncDeck’s activity-owned websocket/session shape, not about identity setup.
- Owner: Codex

- Date: 2026-03-14
- Area: syncdeck
- Discovery: The shared accepted-entry connect helper needed one more rule to be truly authoritative: when a waiting-room-issued `participantId` is present and not yet in the participant list, the first connect must preserve that exact ID instead of minting a fresh one. With that in place, SyncDeck can now create first-time student records directly on websocket join from accepted entry, and the client no longer needs a pre-connect `register-student` round-trip.
- Why it matters: This removes the last meaningful client-side compatibility layer from SyncDeck student entry and brings its new-entry path much closer to the other session-backed activities.
- Evidence: `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/entryIdentityUtils.ts`
- Follow-up action: Reuse this preserved-participant-id rule for other activities whenever accepted entry should be the first authoritative source of participant identity, not just a source of fallback names.
- Owner: Codex

- Date: 2026-03-18
- Area: activities | embedded activity manager controls
- Discovery: `CHILD:*` session ids are hard-blocked from `DELETE /api/session/:sessionId` by the shared server session route. Embedded child managers must either hide/disable local "End Session" controls with `isEmbeddedChildSessionId()` or route termination through the parent SyncDeck embedded-session endpoint instead of calling the generic delete route directly.
- Why it matters: Activity-owned manager UIs can bypass the shared `SessionHeader` guard and end up surfacing a button that now fails with a server-side `403` in embedded mode.
- Evidence: `server/core/sessions.ts`; `client/src/components/common/sessionHeaderUtils.ts`; `client/src/components/common/SessionHeader.tsx`; `activities/embedded-test/client/manager/EmbeddedTestManager.tsx`
- Follow-up action: When adding new embedded child manager UIs, check for any activity-owned end-session buttons that bypass `SessionHeader` and guard them explicitly.
- Owner: Codex

- Date: 2026-03-18
- Area: activities | embedded-test | websocket participant identity
- Discovery: Student websocket `studentName` query params for `embedded-test` should be normalized with participant/display-name rules, not chat-message rules. Missing names must stay `null` so accepted-entry fallback still resolves the authoritative display name, while explicit names should still be trimmed to the tighter participant cap.
- Why it matters: Reusing a chat sanitizer (`normalizeMessageText`) allows unexpectedly long names into persisted session state and blurs the boundary between message content and participant identity constraints.
- Evidence: `activities/embedded-test/server/routes.ts`; `activities/embedded-test/server/routes.test.ts`; `server/core/acceptedSessionParticipants.ts`
- Follow-up action: When adding websocket or REST student join paths in other activities, prefer a dedicated optional participant-name normalizer instead of reusing message-body sanitizers.
- Owner: Codex

- Date: 2026-03-18
- Area: server | syncdeck | embedded child session ids
- Discovery: The embedded child session prefix should include its trailing colon in the shared constant (`CHILD:`), and child-session builders should concatenate the rest of the id directly instead of appending another separator. That keeps creation and `startsWith('CHILD:')` detection aligned across server and client layers.
- Why it matters: A bare-prefix constructor (`CHILD`) can drift from delete guards and client helpers that check for `CHILD:`; once the shared constant is corrected, any leftover `:${...}` concatenation produces malformed ids like `CHILD::parent:...`.
- Evidence: `server/core/sessions.ts`; `activities/syncdeck/server/routes.ts`; `client/src/components/common/sessionHeaderUtils.ts`; `server/sessionEntryRoutes.test.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Prefer importing the shared prefix constant anywhere child session ids are constructed on the server, and keep client-only detection helpers keyed to the same literal.
- Owner: Codex

- Date: 2026-03-19
- Area: client | manage-dashboard | create-session bootstrap storage
- Discovery: Same-tab create-session bootstrap payload persistence now needs pruning in both the in-memory map and the `create-session-bootstrap:*` `sessionStorage` namespace. Keeping only the map trimmed is not enough once payloads are written to browser storage for reload resilience.
- Why it matters: Long-lived dashboard tabs can accumulate abandoned bootstrap records in `sessionStorage`, eventually hitting quota and causing later bootstrap writes to fail even though the in-memory cache still looks bounded.
- Evidence: `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/manageDashboardUtils.test.ts`
- Follow-up action: If another browser-storage-backed bootstrap cache is added, give it the same prefix-scoped TTL/max-entry pruning path rather than relying on consume-time cleanup alone.
- Owner: Codex

- Date: 2026-03-19
- Area: activities | standalone permalink launch
- Discovery: Activities that support permalink solo entry but still need activity-owned setup should persist a `standaloneMode` flag on the created session and let the student client branch off that normalized public session data, instead of teaching shared routing about each activity’s solo runtime behavior.
- Why it matters: This keeps waiting-room/shared entry code generic while still letting activities like SyncDeck and Video Sync disable live-sync plumbing and unlock their own standalone controls after the handoff.
- Evidence: `activities/syncdeck/client/index.tsx`; `activities/syncdeck/server/routes.ts`; `activities/video-sync/client/index.ts`; `activities/video-sync/server/routes.ts`; `activities/video-sync/client/student/VideoSyncStudent.tsx`
- Follow-up action: Reuse the same session-backed `standaloneMode` pattern for future permalink-only solo activities that need custom student runtime behavior after launch.
- Owner: Codex

- Date: 2026-03-19
- Area: activities | syncdeck | synchronized embedded slide handoff
- Discovery: A synchronized student can miss a newly launched embedded child session if SyncDeck does only a one-shot parent-session reconcile when the slide reports `activityRequest`. If that fetch lands before the manager finishes creating the child, the student stays on stale `embeddedActivities` until reload.
- Why it matters: The symptom looks activity-specific because reload suddenly works, but the real bug is the race between the deck’s `activityRequest` and the parent session reflecting the new embedded child.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: When adding new embedded-slide handoffs, treat the deck’s current-slide `activityRequest` as the pending signal and keep reconciling until the expected child session appears or the request ages out.
- Owner: Codex

- Date: 2026-03-19
- Area: client | waiting room | syncdeck teacher redirect
- Discovery: Teacher redirects that leave the waiting room should use the shared `buildPersistentTeacherManagePath(...)` helper, not inline `/manage/...${queryString}` concatenation. SyncDeck manager query params can carry the permalink layer’s generic `urlHash`, which is invalid for SyncDeck’s activity-specific configure hash and forces the manager back into the configure screen.
- Why it matters: The dashboard resume path already strips SyncDeck permalink query params before redirecting to the manager; waiting-room teacher auth needs to match that behavior or freshly edited SyncDeck permalinks behave differently depending on how they are opened.
- Evidence: `client/src/components/common/waitingRoomTeacherSubmitUtils.ts`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.test.ts`
- Follow-up action: Reuse shared route builders for activity-specific teacher redirects instead of duplicating redirect strings inside waiting-room helpers.
- Owner: Codex

- Date: 2026-03-19
- Area: client | manage dashboard | activity-owned permalink builders
- Discovery: Activity-owned permalink builders need edit-state props as well as create-mode props. Otherwise edit falls back to the generic dashboard form and can silently bypass activity-specific validation or generation flows such as SyncDeck’s Reveal preflight and `generate-url` handling.
- Why it matters: The UI can look similar while behaving differently; for SyncDeck this caused edited links to skip verification and diverge from the create flow.
- Evidence: `types/activity.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`
- Follow-up action: When adding custom permalink builders for other activities, make sure both create and edit paths are covered before leaving the generic-form fallback in place.
- Owner: Codex

- Date: 2026-03-19
- Area: activities | syncdeck | manager overlay navigation
- Discovery: SyncDeck manager overlay arrows need to scope iframe-reported `canGoUp` and `canGoDown` to the slide indices that produced them. Reusing the last capability payload without matching `h`/`v` lets stale vertical bounds from the previous slide override the current stack position.
- Why it matters: In vertical stacks like `2:0 -> 2:1 -> 2:2`, the instructor can move correctly while the overlay controls stay visually wrong, for example leaving `up` disabled at `2:1` or leaving `down` enabled at `2:2`.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: When consuming iframe navigation metadata for overlay controls, always track the indices that emitted the capability payload and ignore it after the deck moves to a different slide.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | embedded manager bootstrap
- Discovery: Resonance embedded child sessions need to mint their `instructorPasscode` during session normalization, not only in the standalone `/api/resonance/create` route. SyncDeck embedded launches create the raw child session directly, and the embedded manager auto-auth bootstrap only appears when the child session already has a passcode.
- Why it matters: Without a child passcode at creation time, embedded Resonance managers opened from SyncDeck fall into the "Instructor passcode not found in session storage" state even though a parent instructor session exists.
- Evidence: `activities/resonance/server/routes.ts`; `activities/resonance/server/routes.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`
- Follow-up action: For future instructor-managed embedded activities, ensure any session secret or manager-auth credential is produced by the activity normalizer or child-session creation path rather than only by the standalone create endpoint.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | instructor progress visibility
- Discovery: Resonance instructor review now needs two parallel data surfaces: final `responses` for submitted answers and `responseDrafts` for in-progress work. The instructor snapshot should merge them into a unified progress view with explicit `working` vs `submitted` status instead of trying to overload the submitted response model.
- Why it matters: Draft pushes are frequent and ephemeral, while submitted answers remain the authoritative share/report surface. Keeping drafts separate avoids confusing reorder/share/annotation flows with partial work while still letting the instructor watch answers in progress.
- Evidence: `activities/resonance/server/routes.ts`; `activities/resonance/shared/types.ts`; `activities/resonance/client/student/QuestionView.tsx`; `activities/resonance/client/manager/ResponseViewer.tsx`
- Follow-up action: If Resonance later adds report exports or richer review filters, treat `responseDrafts` as transient instructor telemetry and keep `responses` as the durable submitted record unless a feature explicitly needs draft history.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | multi-question live runs
- Discovery: Resonance needs a session-level live-run model (`activeQuestionIds` plus a shared `activeQuestionDeadlineAt`) when multiple questions can be open at once. Keeping only `activeQuestionId` is enough for the old single-question flow but breaks student navigation, question-targeted submissions, and any shared countdown across several live prompts.
- Why it matters: “Activate all questions” is not just a UI convenience; it changes server validation and student state. Students need to submit against a specific active question, the manager needs a single countdown for the whole run, and older snapshots still need a fallback `activeQuestionId` for compatibility.
- Evidence: `activities/resonance/server/routes.ts`; `activities/resonance/shared/types.ts`; `activities/resonance/client/manager/ResonanceManager.tsx`; `activities/resonance/client/student/ResonanceStudent.tsx`; `activities/resonance/server/routes.test.ts`
- Follow-up action: Future Resonance features that depend on “what is live right now” should build on the session run fields first and treat `activeQuestionId` as compatibility state, not the authoritative source.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | manager question panel
- Discovery: The selected-question panel in Resonance manager should stay focused on review and sharing, not on starting or stopping live runs. Live activation controls still belong in the question list/sidebar where multi-question runs are managed.
- Why it matters: Duplicating activation actions inside the selected-question panel makes the manager UI harder to scan and creates overlapping control surfaces for the same live-run state.
- Evidence: `activities/resonance/client/manager/ResonanceManager.tsx`; `activities/resonance/client/manager/ResonanceManager.test.ts`
- Follow-up action: If Resonance adds more question-panel actions later, keep them scoped to review/share workflows unless the product explicitly wants a second live-run control surface there.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | manager question list truncation
- Discovery: The Resonance manager question list should show `Show more` based on actual rendered text overflow, not a fixed character-count guess. The narrow sidebar can truncate stems well before they pass an arbitrary length threshold.
- Why it matters: Character-count heuristics miss real truncation cases like medium-length prompts in narrow layouts, leaving users with cut-off stems and no way to expand them.
- Evidence: `activities/resonance/client/manager/ResonanceManager.tsx`; `activities/resonance/client/manager/ResonanceManager.test.ts`
- Follow-up action: If the question list layout changes again, keep the expansion affordance tied to measured overflow rather than copy length so it stays accurate across widths and font changes.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | manager response cards
- Discovery: Free-response `ResponseCard` actions read better when the student-specific tools stay grouped in one left control stack. Star, flag, emoji, and share belong together, while reorder arrows can stay separated as layout controls.
- Why it matters: Splitting share and emoji away from the star/flag stack makes the per-response actions harder to scan and increases pointer travel during instructor review.
- Evidence: `activities/resonance/client/manager/ResponseCard.tsx`; `activities/resonance/client/manager/ResponseCard.test.tsx`
- Follow-up action: If more response-level tools are added later, prefer keeping content actions in the left stack and reserve the opposite edge for ordering or layout controls.
- Owner: Codex

- Date: 2026-03-20
- Area: activities | resonance | student graded mcq reveal
- Discovery: Shared graded MCQ results are clearer in the student view when they use the same percentage breakdown as polls, with a separate `Your response: Correct/Incorrect` summary card above the option list instead of a generic “shared” banner.
- Why it matters: Students need to see both their own selected answer and the class distribution at once. Treating graded MCQ like a poll with correct/incorrect row styling makes the reveal easier to scan and avoids implying that only one raw response card was shared.
- Evidence: `activities/resonance/client/student/SharedResponseFeed.tsx`; `activities/resonance/client/student/SharedResponseFeed.test.tsx`
- Follow-up action: If MCQ reveal styling evolves further, keep the student summary card and the aggregate option breakdown distinct so correctness feedback and class distribution do not compete for the same space.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | uploaded report parsing
- Discovery: `parseResonanceReport` must validate each uploaded multiple-choice option as an object with non-empty string `id` and `text`, plus optional boolean `isCorrect`, instead of only checking that `options` is an array.
- Why it matters: Resonance report JSON is user-supplied. Accepting arrays like `[null, 1]` lets malformed uploads reach the report viewer, which then dereferences `opt.id` and `opt.text` and can crash instead of rejecting the file cleanly.
- Evidence: `activities/resonance/client/tools/ResonanceReport.tsx`; `activities/resonance/client/tools/ResonanceReport.test.ts`
- Follow-up action: When new uploadable report fields are added, validate every nested structure that render paths dereference rather than relying on top-level array checks alone.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | syncdeck | embedded entry participant recovery
- Discovery: SyncDeck embedded child-session recovery should rely on `readStoredSessionParticipantIdentity(...)` instead of treating any non-empty `session-participant:*` localStorage value as a valid child identity.
- Why it matters: Malformed shared context like bad JSON or `{}` can block embedded token recovery even though the child session has no usable stored identity. Reusing the shared reader clears invalid payloads, preserves valid legacy `student-name-*` / `student-id-*` fallbacks, and only suppresses recovery when a real identity exists.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/sessionParticipantContext.ts`
- Follow-up action: Keep embedded-session recovery checks on the same shared identity-normalization path used by entry flows so storage cleanup and legacy migration stay consistent.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | uploaded report reveal parsing
- Discovery: `parseResonanceReport` should validate nested reveal fields used by the viewer, not just that `reveal` is an object. At minimum, `questionId` must be a non-empty string, `sharedAt` a number, `correctOptionIds` either `null` or `string[]`, and `sharedResponses` an array.
- Why it matters: Uploaded report JSON is untrusted. Malformed reveal payloads can otherwise survive parsing and reach render paths that call `.length` or `.includes` on `correctOptionIds`, leading to avoidable runtime failures instead of a clean “invalid report” rejection.
- Evidence: `activities/resonance/client/tools/ResonanceReport.tsx`; `activities/resonance/client/tools/ResonanceReport.test.ts`
- Follow-up action: Whenever the report viewer starts dereferencing additional reveal fields, extend the upload validator in the same change so parsing stays aligned with render assumptions.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | gimkit csv compatibility
- Discovery: Resonance should treat Gimkit CSV export as a narrow compatibility format: only multiple-choice questions with exactly one correct answer should be written to CSV.
- Why it matters: The tools UI can build free-response prompts and poll-style MCQs that do not map cleanly onto the Gimkit CSV schema. Exporting those rows creates CSVs that cannot round-trip through the importer without inventing placeholder answers or changing question semantics.
- Evidence: `activities/resonance/client/tools/ResonanceToolShell.tsx`; `activities/resonance/client/tools/ResonanceToolShell.test.ts`; `activities/resonance/shared/validation.ts`
- Follow-up action: Keep JSON export as the full-fidelity path for mixed question sets, and keep `parseGimkitCSV(...)` aligned with the same single-correct-MCQ-only contract rather than accepting broader Resonance-specific semantics.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | client-side option ids
- Discovery: Resonance question-builder option ids should use `crypto.randomUUID()` when available, with a timestamp-plus-random fallback, instead of a short `Math.random()` slice.
- Why it matters: Option ids participate in MCQ selection, correctness lookup, and validation. Short random slices can collide within a draft and create duplicate option ids that break selection or reveal behavior before validation catches them.
- Evidence: `activities/resonance/client/tools/QuestionBuilder.tsx`; `activities/resonance/client/tools/QuestionBuilder.test.ts`
- Follow-up action: Keep future client-generated Resonance question ids and option ids on the same UUID-first pattern used elsewhere in the repo unless a deterministic id source is available.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | syncdeck | embedded entry recovery
- Discovery: SyncDeck embedded entry-token recovery should only persist a recovered token when the response `childSessionId` exactly matches the currently active embedded child session.
- Why it matters: Recovery requests can resolve late or stale. Persisting a returned token under a different child-session key can poison another embedded activity’s handoff storage and block the right session from retrying cleanly.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep future embedded recovery responses keyed and validated against the currently active child session before writing session storage or marking a recovery attempt successful.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | student snapshot normalization
- Discovery: `normalizeStudentSessionSnapshot(...)` should filter `activeQuestions`, `activeQuestion`, `revealedQuestions`, `reveals`, and `reviewedResponses` through minimal validators before exposing them to the student UI.
- Why it matters: REST and websocket payloads are defensive boundaries. Passing through malformed entries like `null`, reveals without numeric `sharedAt`, or reviewed responses without a valid `question` lets `ResonanceStudent` and reveal views crash when they sort or dereference nested fields.
- Evidence: `activities/resonance/client/hooks/useResonanceSession.ts`; `activities/resonance/client/hooks/useResonanceSession.test.ts`; `activities/resonance/client/student/ResonanceStudent.tsx`
- Follow-up action: When student snapshot consumers start dereferencing more nested question fields, extend the normalizer at the same time rather than pushing new guards into each consumer.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | instructor snapshot normalization
- Discovery: `normalizeInstructorStateSnapshot(...)` should filter `responses`, `progress`, and `reveals` entries to minimally valid instructor shapes before deriving submitted progress or exposing reveal data to the manager UI.
- Why it matters: The instructor REST/websocket snapshot is also a defensive boundary. Malformed `responses` can throw during `submittedProgress` derivation, and malformed `reveals` can crash manager views that dereference `reveal.questionId` or assume reveal entries are objects.
- Evidence: `activities/resonance/client/hooks/useInstructorState.ts`; `activities/resonance/client/hooks/useInstructorState.test.ts`
- Follow-up action: Keep derived instructor state built only from validated snapshot entries, and extend the normalizer whenever new consumer code starts dereferencing additional nested fields.
- Owner: Codex

- Date: 2026-03-21
- Area: client | manage dashboard | activity-owned permalink builders
- Discovery: The clean split for activity-owned permalink builders is a single shared-submit contract: activities own rich option UI, validation, previews, and preparation of string `selectedOptions`, while `ManageDashboard` always owns teacher-code semantics, entry mode, and the final signed persistent-link request.
- Why it matters: That keeps shared permalink behavior centralized and prevents activities from quietly forking create/update semantics just because they need richer custom controls than the generic option form.
- Evidence: `client/src/components/common/ManageDashboard.tsx`; `types/activity.ts`; `types/activityConfigSchema.ts`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/resonance/client/tools/ResonancePersistentLinkBuilder.tsx`
- Follow-up action: When adding future custom permalink builders, keep them on the shared-submit contract unless the repo deliberately introduces a new generic capability for richer builder outputs.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | syncdeck | permalink builder ownership
- Discovery: SyncDeck permalink setup should keep its custom presentation URL control, reveal-sync verification, and preview iframe, but delegate the final create/update request back to `ManageDashboard` through the shared custom-builder callbacks instead of posting to persistent-session routes directly.
- Why it matters: SyncDeck keeps the deck-specific UX teachers need, while shared code still owns entry mode changes and the final signed permalink body so SyncDeck cannot accidentally fork shared permalink behavior.
- Evidence: `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `client/src/components/common/ManageDashboard.tsx`
- Follow-up action: If SyncDeck later adds more deck-specific permalink inputs, keep them flowing through `selectedOptions` + submit-readiness callbacks unless the server-side signing contract itself needs to become activity-owned.
- Owner: Codex

- Date: 2026-03-21
- Area: activities | resonance | permalink builder ownership
- Discovery: Resonance can use the same shared custom-builder permalink flow as SyncDeck as long as it treats encrypted question payload preparation as activity-specific data shaping, not as the platform's persistent-link signing step.
- Why it matters: The clean boundary is for Resonance to keep its upload/editor UI and server-side `q`/`h` preparation, while `ManageDashboard` continues to own teacher code UI, entry mode, and the final persistent-session create/update request. That keeps shared permalink behavior consistent without forcing shared code to understand Resonance question structures.
- Evidence: `activities/resonance/activity.config.ts`; `activities/resonance/client/tools/ResonancePersistentLinkBuilder.tsx`; `activities/resonance/server/routes.ts`; `client/src/components/common/ManageDashboard.tsx`
- Follow-up action: If future activities need custom permalink preparation, prefer returning finalized string `selectedOptions` plus submit readiness instead of letting the activity mint the full permalink URL.
- Owner: Codex

- Date: 2026-03-22
- Area: tooling | e2e | playwright
- Discovery: On this Linux Arm64 dev environment, Playwright can be installed successfully with `@playwright/test` plus `npx playwright install chromium webkit`, but branded `chrome` is not supported here and Safari coverage should be represented by the Playwright `webkit` engine instead.
- Why it matters: Future browser-test setup should target `chromium` and `webkit` in local/devcontainer automation on Arm64 rather than assuming branded Chrome or native Safari binaries are available.
- Evidence: `package.json`; `package-lock.json`; local install command output from `npx playwright install chrome webkit` and `npx playwright install chromium webkit`
- Follow-up action: When adding the Playwright config, default projects to `chromium` and `webkit` in this repo, and only add branded-browser channels where the host platform supports them.
- Owner: Codex

- Date: 2026-03-22
- Area: tooling | e2e | playwright
- Discovery: The shared Playwright harness should run against an isolated production-style server on `127.0.0.1:3100` with a test-only `PERSISTENT_SESSION_SECRET`, not through the interactive dev server on `localhost:3000`.
- Why it matters: This avoids dev-server/browser-launch side effects during automated runs while still exercising the real built app with production-mode startup constraints.
- Evidence: `playwright.config.ts`; `package.json`
- Follow-up action: Keep future Playwright docs, commands, and CI wiring pointed at the root `npm run test:e2e` scripts and the shared root config instead of adding one-off dev-server browser test commands.
- Owner: Codex
- Date: 2026-03-23
- Area: activities | syncdeck | utility launch routing
- Discovery: SyncDeck static-host launch should be modeled as a hidden utility route (`/util/syncdeck/launch-presentation`) declared in `activity.config.*`, with the utility entry omitting `surfaces` so it stays routable but does not appear on `/manage` or the home page.
- Why it matters: This keeps the flow activity-owned and compatible with the existing utility-route machinery while avoiding cross-origin browser CORS problems for statically hosted presentations.
- Evidence: `activities/syncdeck/activity.config.ts`; `client/src/components/common/SessionRouter.tsx`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`
- Follow-up action: If more activities need hidden utility routes that render `UtilComponent`, keep using `utilities[].renderTarget = 'util'` rather than adding one-off router branches.
- Owner: Codex
- Date: 2026-03-26
- Area: client | activities | vite | hmr
- Discovery: The shared activity client-module resolution cache should not persist across Vite development/HMR updates. In dev, preflight/preload helpers can otherwise keep returning a previously resolved activity client export even after the underlying `activities/*/client/index.*` module hot-updates.
- Why it matters: This cache sits below lazy component loading and is used by preflight, persistent solo launch, and preload helpers, so stale resolved exports can make development behavior diverge from the freshly reloaded client bundle.
- Evidence: `client/src/activities/index.ts`; `client/src/activities/index.cache.test.ts`
- Follow-up action: Keep resolved-module caching production-only unless a future dev-time strategy explicitly revalidates or clears cache entries on every relevant hot update.
- Owner: Codex
- Date: 2026-03-24
- Area: activities | syncdeck | utility launch routing
- Discovery: SyncDeck's hidden utility launch route should reuse the standalone-session path, not the manager bootstrap path. The utility now creates/configures `standaloneMode: true` sessions and redirects to `/:sessionId`, matching the existing `launchPersistentSoloEntry` behavior used elsewhere in the app.
- Why it matters: This keeps static-hosted presentation launch aligned with SyncDeck's real solo student runtime and avoids leaking manager-only assumptions like instructor passcode bootstrap into a presentation-owned "launch in SyncDeck" entry point.
- Evidence: `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/index.tsx`; `client/src/components/common/WaitingRoom.tsx`
- Follow-up action: Future utility-based static presentation launches should treat `launchPersistentSoloEntry` as the canonical redirect/auth model unless the product explicitly needs manager mode.
- Owner: Codex
- Date: 2026-03-24
- Area: activities | resonance | self-paced embedded sessions
- Discovery: Resonance needs an explicit student-safe `selfPacedMode` snapshot signal when launched from a standalone SyncDeck parent, but that flag must reflect effective fallback behavior rather than sticky session origin. It should be `true` only while no live question run is active, so the student client can return to normal run-restart semantics once an instructor-activated set appears.
- Why it matters: Without a self-paced flag, embedded solo Resonance sessions look like “no active question” dead-ends because the normal live-session model expects an instructor to activate questions and share results.
- Evidence: `activities/resonance/server/routes.ts`; `activities/resonance/client/student/ResonanceStudent.tsx`; `activities/resonance/client/student/SharedResponseFeed.tsx`
- Follow-up action: If other embedded activities need solo/self-paced behavior under SyncDeck, prefer a student-safe snapshot mode flag over client heuristics based on missing active items.
- Owner: Codex
- Area: activities | resonance | standalone embedded launch
- Discovery: Resonance standalone embeds inside SyncDeck solo mode use the activity-owned persistent solo launcher path rather than `/solo/resonance`. `activities/resonance/activity.config.ts` must keep `standaloneEntry.enabled = true`, `supportsDirectPath = false`, and `supportsPermalink = true`, and the launcher in `activities/resonance/client/index.tsx` must translate prepared `selectedOptions.q/h` into `POST /api/resonance/create` with `selfPacedMode: true`.
- Why it matters: If either the capability flags or the client launcher drift, SyncDeck falls back to the solo overlay notice “This activity requires a live session.” instead of creating an answerable self-paced Resonance child session.
- Evidence: `activities/resonance/activity.config.ts`; `activities/resonance/client/index.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Future standalone-capable embedded activities should either support direct `/solo/:activityId` paths or implement `launchPersistentSoloEntry`; selected-options-only activities like Resonance need the latter.
- Owner: Codex
- Date: 2026-03-24
- Area: activities | syncdeck | resonance embedded solo payloads
- Discovery: SyncDeck solo overlays must preserve opaque `activityOptions`, not just string-valued entries, because Resonance slide metadata currently embeds raw `questions` arrays in `data-activity-options`. The Resonance solo launcher and `POST /api/resonance/create` therefore need to accept either prepared `q/h` selectedOptions or a validated raw `questions` payload for self-paced standalone launches.
- Why it matters: If SyncDeck trims non-string options, Resonance overlays get stuck forever at “Launching solo activity…” because the launcher never receives a usable question payload.
- Evidence: `activities/syncdeck/dev-presentations/syncdeck-conversion-lab.html`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/resonance/client/index.tsx`; `activities/resonance/server/routes.ts`
- Follow-up action: Keep the iframe message schema’s “activityOptions are opaque host input” rule true in the solo-launch path as well as the synchronized embedded path.
- Owner: Codex
- Date: 2026-03-24

- Date: 2026-03-27
- Area: `client/src/components/common/WaitingRoom.tsx`
- Discovery: Teacher-entry mode must reset from the live derived waiting-room state (`currentEntryOutcome` plus `currentStartedSessionId` / `effectiveEntryOutcome`), not only from the initial `entryOutcome` prop, because websocket transitions can flip `join-live` back to `continue-solo` without a prop change.
- Why it matters: If the UI keeps stale teacher-entry mode active after a `session-ended` transition, the toggle disappears and the student join UI stays hidden.
- Owner: Codex
- Date: 2026-03-27
- Area: home-page teacher recovery
- Discovery: Rejoining an active instructor session from `/` should reuse the persistent-session teacher auth model by looking up `sessionId -> persistent hash`, rather than inventing a separate live-session credential path.
- Why it matters: Second instructors often only have the live join code after class starts; without the persistent lookup, they cannot recover manage access unless they still have the original permalink.
- Owner: Codex
- Date: 2026-03-27
- Area: client routing | manager session teardown
- Discovery: Manager routes need a shared session-existence guard on `/manage/:activityId/:sessionId`, because student views already handle `session-ended` but instructor views are activity-specific and do not consistently attach that redirect logic.
- Why it matters: Without the shared guard, a second instructor can stay stranded on a stale manager screen after another instructor ends the session.
- Evidence: `client/src/App.tsx`; `client/src/components/common/ManagedSessionRoute.tsx`
- Owner: Codex
- Date: 2026-04-08
- Area: activities | syncdeck | embedded overlay navigation
- Discovery: Embedded activity navigation controls should use app-drawn SVG arrows instead of Unicode triangle glyphs inside circular buttons.
- Why it matters: Windows font fallback can render those glyphs as emoji-style symbols with colored square backgrounds, which breaks the intended neutral overlay control styling.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/shared/embeddedOverlayNavigation.ts`
- Follow-up action: For any cross-platform icon-only control in shared overlays, prefer inline SVG or CSS-drawn shapes over text glyphs unless platform rendering is explicitly desired.
- Owner: Codex
