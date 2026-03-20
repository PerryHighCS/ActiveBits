# SyncDeck Combined Activities Control Plan

## Goal

Replace the separate `Activities` launcher button and `Running activities: N` management chip in the SyncDeck instructor console with a single control that supports both:

- launching ad hoc embedded activities on the current slide anchor
- switching among all currently running embedded activities

The combined control should behave like the primary embedded-activity entry point for the instructor.

## Current State

Today the instructor console exposes two adjacent controls in
[`activities/syncdeck/client/manager/SyncDeckManager.tsx`](/workspaces/ActiveBits/activities/syncdeck/client/manager/SyncDeckManager.tsx):

- `Activities`
  - opens `syncdeck-activity-picker-panel`
  - lists launchable activities only
  - does not show running instances
- `Running activities: N`
  - opens `syncdeck-running-activities-panel`
  - lists already running embedded activity instances
  - supports end/report actions
  - does not support launching a new activity

This split makes the instructor switch mental models depending on whether they want to start or manage an activity, even though both actions are part of the same embedded-activity workflow.

## Target UX

Use a single `Activities` button as the only embedded-activity console entry point.

The button should:

- remain visible in the instructor toolbar
- show useful running-state context, for example `Activities (2)` when there are running instances
- open one unified panel instead of two separate panels

The unified panel should contain two sections:

1. `Running Activities`
   - appears first when one or more embedded activities exist
   - lets the instructor switch to any running activity
   - preserves existing end/report controls
   - clearly marks the currently active embedded instance

2. `Launch Activity`
   - lists launchable activity types
   - preserves the current ad hoc launch behavior
   - continues to launch on the current slide anchor using the existing start flow

## Interaction Model

### Button behavior

- Clicking `Activities` toggles a single panel.
- The old `Running activities: N` button should be removed.
- The button label should incorporate running count when non-zero.

### Running activity switching

Selecting a running activity should:

- navigate the instructor view to that activity's anchor if needed
- surface that activity as the active embedded manager overlay
- avoid launching a duplicate embedded child if the chosen instance already exists

Expected implementation direction:

- reuse the existing instance-key based positioning helpers
- use `buildManagerResyncCommandForInstanceKey(instanceKey)` when the requested activity is not currently active
- close the unified panel after switching

### Launch behavior

Launching from the unified panel should:

- keep the existing `handleActivityPickerLaunch` / `handleResolvedActivityRequests` flow
- close the unified panel after a successful launch request is initiated
- remain disabled when the configure panel is open

### Empty state behavior

When no embedded activities are running:

- the unified panel should still open normally
- the running section should show a simple empty state
- the launch section should still be immediately available

## Proposed Implementation Steps

- [ ] Introduce a single panel state for the combined activities control in `SyncDeckManager`.
- [ ] Remove the standalone running-activities button and panel.
- [ ] Move the running-activity list UI into the combined activities panel.
- [ ] Add a switch action for each running instance.
- [ ] Preserve existing end-confirmation and report-download affordances for running instances.
- [ ] Update the button label so it communicates current running count.
- [ ] Ensure launch and switch actions close or preserve panel state intentionally.
- [ ] Add or update tests for unified button rendering, empty/running panel states, and switch behavior helpers.
- [ ] Update durable notes if implementation reveals reusable SyncDeck embedded-activity navigation guidance.

## Data and State Notes

No server contract change is expected for the first pass.

This should remain a manager-only UI/state refactor built on the existing client-side data:

- `embeddedActivities`
- `runningEmbeddedActivityCount`
- `activeEmbeddedInstanceKey`
- `resolveManagerActiveEmbeddedInstanceKey(...)`
- `buildManagerResyncCommandForInstanceKey(...)`
- existing embedded end/report handlers

## Risks and Design Questions

### 1. Switch semantics versus launch semantics

Launching creates a new child session. Switching should not.

Guardrail:

- keep launch actions wired only to activity-type entries
- keep switch actions wired only to existing instance keys

### 2. Multiple running instances of the same activity type

The panel must distinguish instances by more than `activityId`.

Recommendation:

- show activity name plus instance key or anchor context
- keep child session id available as secondary metadata when useful

### 3. Active-instance discoverability

The instructor should understand which embedded activity is currently shown.

Recommendation:

- preserve the current `Active` indicator in the running section
- add a `Switch` or `Open` button for non-active rows
- consider replacing the action with `Viewing` for the active row

### 4. Panel density

Combining both sections into one panel may increase height.

Recommendation:

- keep the panel scrollable
- prioritize the running section first so active management is not hidden below the launch list

## Verification Plan

Minimum checks after implementation:

- `npm_config_target=activities/syncdeck npm --workspace activities run test:scope`
- `npm_config_target=activities/syncdeck npm --workspace activities run lint:scope`
- `npm --workspace activities run typecheck`

Suggested test coverage:

- manager renders one combined `Activities` control instead of separate controls
- combined panel shows running-count context when instances exist
- combined panel renders empty running state when none exist
- helper logic for switching to a running instance resolves the correct navigation command
- launch list remains available inside the combined panel

## Success Criteria

The work is complete when:

- instructors use one `Activities` entry point for both launch and running-instance management
- running activities are switchable without opening a separate panel
- existing end/report capabilities remain intact
- ad hoc launch still works from the same surface
- SyncDeck manager tests, lint, and typecheck pass
