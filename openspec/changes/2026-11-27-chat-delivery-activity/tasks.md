# Tasks

## 1. Adopt delivery events

- [ ] 1.1 Consume the SDK delivery and activity events in the plugin delivery-state helper and verify the event wiring with the existing routing/delivery unit tests

## 2. Replace heuristic workaround

- [ ] 2.1 Replace local heuristic delivery polling with the event-driven state and verify stale-heuristic paths are covered

## 3. Surface activity

- [ ] 3.1 Surface the wake reason / reply replacement line in the session action and Work Status and verify with the status view tests

## Workflow follow-up

- [ ] Archive this change after implementation and the `chat-delivery-activity` spec stabilizes.
