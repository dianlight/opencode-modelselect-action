# Tasks

## 1. Schedule contract

- [x] 1.1 Add two `contributes.service.schedule` entries (routing refresh, quota probe) to the manifest, and verify manifest validation accepts them.
- [x] 1.2 Implement `POST /schedule` with the SDK schedule parser and version check, and verify valid runs succeed and unknown versions are rejected.

## 2. Replace the interval

- [x] 2.1 Route both schedule ids through `maintain()` under the existing per-project throttle, and verify a wake inside the window performs no extra refresh.
- [x] 2.2 Remove the `setInterval` and `keepRunning` declaration once schedule runs are verified, and verify an idle service starts no refresh timer.

## 3. Verification

- [x] 3.1 Add sim scenarios for scheduled refresh, no open project and router-switch immediate refresh, and verify `npm run sim` passes.
- [x] 3.2 Document the schedule entries and the removed polling in the extension README, and verify the manifest and README agree.
