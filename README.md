# ActiveBits

ActiveBits is a classroom-focused platform for interactive computer science activities.  
Teachers can launch live sessions, share join links, and guide students through hands-on exercises in real time.
Instructors can also rejoin an active live session from the home page with the `Teacher Join` flow using a Join Code and teacher code.

Current activity areas include:
- Raffle-based search and problem-solving activities
- Network and web-systems simulations
- Algorithm demonstrations
- Live response collection and class discussion activities
- Java and Python practice activities
- Standalone practice and utility flows for independent student work
- MobCode live sessions, including instructor-controlled private student code workspaces

SyncDeck can embed supported activities inside a presentation; embedded instructor views are launched through the active SyncDeck session and do not require teachers to repeat child-activity setup. Activities with manager credentials receive them through a short-lived handoff; credentialless activities such as Raffle launch directly. The initiating manager applies the authenticated launch response locally, so first-load embedded activities do not wait for a websocket replay before mounting, and it performs a bounded refresh for an expired or consumed child bootstrap.
SyncDeck also preserves a temporary-session instructor's control after a reload with a bounded, browser-session httpOnly recovery cookie; instructor passcodes are never stored in browser storage.
Waiting-room display names are remembered for one year in a same-site browser cookie so students can rejoin on later days without retyping them; this cookie contains only the entered name.

## Documentation

Start here:
- [Adding Activities](ADDING_ACTIVITIES.md) - how to build and register a new activity
- [Architecture Guide](ARCHITECTURE.md) - system boundaries, session model, and activity loading
- [Deployment Guide](DEPLOYMENT.md) - production deployment and operations

Activity-specific documentation:
- [Algorithm Demo: README](activities/algorithm-demo/README.md)
- [Algorithm Demo: Quick Start](activities/algorithm-demo/QUICKSTART.md)
- [Algorithm Demo: Extension Guide](activities/algorithm-demo/EXTENSION_GUIDE.md)
- [Algorithm Demo: Implementation Notes](ALGORITHM_DEMO_IMPLEMENTATION.md)

Additional operational docs:
- [Valkey Development Notes](docs/VALKEY_DEVELOPMENT.md)

## Dev Container Profiles

- Default devcontainer: `.devcontainer/devcontainer.json`
  - Least-privilege setup for normal ActiveBits development.
- Opt-in privileged devcontainer: `.devcontainer/privileged/devcontainer.json`
  - Adds `SYS_ADMIN` and disables AppArmor/seccomp confinement for the app container.
  - Use only for nested sandbox tooling inside the devcontainer, such as agent/debug environments that launch their own sandbox layer.
  - Do not use this profile for routine development unless you specifically need those tools.

## Development

Run `npm run dev` to start the client and server. When a root `.env` file is present,
the command loads it for both processes; it is optional, so a fresh checkout still
starts without one. For an externally reachable development server, set
`HOST=0.0.0.0` and `PORT=3000` in that file.

## Access

- Student site: <https://bits.mycode.run>
- Instructor dashboard: <https://bits.mycode.run/manage>
- Standalone activity launcher: `https://bits.mycode.run/launch/<activity-id>` with optional `?start=1` for instructor-authored links that should immediately start a new session and redirect to the activity manager.

## Learn SyncDeck Integration

ActiveBits can accept authenticated Learn server-to-server SyncDeck launches when both
servers configure the same dedicated HMAC secret. This is separate from any LTI 1.1
consumer secret. Set `LEARN_SYNCDECK_HMAC_SECRET` and, optionally,
`LEARN_SYNCDECK_HMAC_KEY_ID` (default: `learn-default`) only in server-side environment
configuration. See `.agent/plans/learn-syncdeck-session-integration.md` for the request
contract and launch lifecycle.

Learn can also issue a time-bounded signed substitute-instructor link that opens a
SyncDeck instructor session directly in ActiveBits. It is a bearer capability: use a
bounded expiry and do not expose it in logs or analytics.
