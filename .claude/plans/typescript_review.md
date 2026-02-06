Review Summary
The plan is solid and well-sequenced. The major gaps are around TypeScript config scope (shared types not actually included), server module resolution/runtime alignment, and test runner updates for .ts/.tsx.

Gaps / Corrections to Fold Into the Plan

Shared types/ not included anywhere

Right now, *.d.ts won’t be picked up by any tsconfig because each workspace only includes its own src/*.ts.
Fix by adding *.d.ts to each workspace include, or add typeRoots explicitly.
Example change in tsconfig.json, tsconfig.json, tsconfig.json:
Add *.d.ts to include.
Server moduleResolution should match Node ESM

In tsconfig.json, prefer:
module: "NodeNext"
moduleResolution: "NodeNext"
Keep client/activities on bundler.
ESLint TypeScript deps are incorrect

The plan lists typescript-eslint as a package. The actual packages are:
@typescript-eslint/parser
@typescript-eslint/eslint-plugin
Update the plan’s install step and ESLint config accordingly.
Client doesn’t need @types/ws

client uses WebSocket (browser global), not the ws package. @types/ws is only needed in server.
Keep it in server only unless you actually import ws in client.
Test runner scripts need tsx for .ts/.tsx

Update test scripts to use node --import tsx --test for client, server, and activities.
For activities, you can drop jsx-loader-register.mjs once tests are .tsx.
Testing Additions (Aligned to “Contract + Core Units”)
Add tests that protect cross‑boundary shapes and core behavior during migration:

Contract tests for WebSocket messages

Add a test file (e.g. wsRouter.contract.test.ts) that instantiates representative WebSocketMessage payloads and validates router behavior (including error paths).
Ensures runtime behavior matches the compile‑time union type.
Session store invariants

Tests for SessionStore implementations (in‑memory + Valkey) verifying:
create → read → update → delete lifecycle
TTL/expiry handling
normalization (sessionNormalization)
Activity registry contract

Tests that activity config loading returns the expected shape and failure modes.
This protects the most dynamic part of the system during TS migration.
Client activity loader contract

index.ts should have a contract test that validates:
glob results map to ActivityClientModule
required fields exist
unsupported shape is rejected early
Root test flow

Keep typecheck in root test to enforce TS correctness:
npm run typecheck --workspaces --if-present
Keep node --test runtime tests separate (what you already have).