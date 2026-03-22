# ActiveBits

ActiveBits is a classroom-focused platform for interactive computer science activities.  
Teachers can launch live sessions, share join links, and guide students through hands-on exercises in real time.

Current activity areas include:
- Raffle-based search and problem-solving activities
- Network and web-systems simulations
- Algorithm demonstrations
- Live response collection and class discussion activities
- Java and Python practice activities
- Standalone practice and utility flows for independent student work

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

## Access

- Student site: <https://bits.mycode.run>
- Instructor dashboard: <https://bits.mycode.run/manage>
