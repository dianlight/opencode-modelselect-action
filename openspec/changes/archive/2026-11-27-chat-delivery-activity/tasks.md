# Tasks

## 1. Consume the real SDK session events

- [x] 1.1 Subscribe the service to `turn-started`, `turn-finished` and `turn-failed` and record per-session delivery state from `readSessionEventRequest` in a service-owned cache, verified with session-event tests

## 2. Surface event-derived state

- [x] 2.1 Show the recorded activity and newest reply or error in the `/pick` summary and Work Status, with no delivery line before the first event, verified with view/status tests

## 3. Verify the shipped extension

- [x] 3.1 Add a service sim scenario for turn-event delivery state, run lint/build/sim checks, and commit the rebuilt extension bundle

## Workflow follow-up

- [x] Archive this change after implementation and the `chat-delivery-activity` spec stabilizes.
