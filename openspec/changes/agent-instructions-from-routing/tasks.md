# Tasks

## 1. Service

- [ ] 1.1 Call `serviceHost.setInstructions(directory, text)` after a routing sync, with the blended criteria text for the project.
- [ ] 1.2 Clear (empty string) the instructions when routing sync is off or the project closes.
- [ ] 1.3 Keep the plugin's own injection as the fallback on hosts older than 2.7.0.

## 2. Docs

- [ ] 2.1 Document the precedence (host instructions vs plugin context) in the README.

## 3. Verification

- [ ] 3.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
