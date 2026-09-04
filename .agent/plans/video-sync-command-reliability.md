# VideoSync command reliability

Goal: make instructor playback commands authoritative, ordered, retry-safe, and immune to stale telemetry/capability/session writers, including with multiple instructors and multiple server instances.

## Checklist

- [x] Add a generic atomic compare-and-set session-store primitive with in-memory and Valkey coverage.
- [x] Add a normalized VideoSync mutation revision and route all VideoSync session writes through bounded CAS retries.
- [x] Add a monotonic playback revision to state/envelopes and use it instead of wall-clock timestamps for client ordering.
- [x] Make manager playback commands idempotent with command IDs so ambiguous network failures can be retried safely.
- [x] Prevent passive/secondary manager player transitions from becoming authoritative commands; preserve explicit play, pause, seek, and natural completion behavior.
- [x] Add unit/integration coverage for stale telemetry writers, capability issuance races, competing managers, reordered frames, and duplicate command delivery.
- [x] Add browser coverage for multiple manager views where feasible through the shared Playwright harness.
- [x] Update architecture/deployment/data-contract/testing notes for the new ordering and persistence contract.
- [x] Run VideoSync workspace lint/typecheck/tests, root `npm test`, and relevant `npm run test:e2e` coverage.
