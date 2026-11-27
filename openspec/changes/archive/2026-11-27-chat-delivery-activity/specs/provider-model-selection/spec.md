# Spec Delta

## Purpose

Adds a delivery-state requirement to the provider-model-selection capability.
It is derived from the host session events shipped with OpenChamber 2.8.1 and
confined to the extension's own Work Status and session action surfaces.

## ADDED Requirements

### Requirement: A chat exposes delivery state

The runtime selection SHALL expose per-session delivery state in the extension's
Work Status and session action from the host's turn session events
(`turn-started`, `turn-finished`, `turn-failed`), not from local timing
heuristics. The host SHALL keep ownership of folding a reply replaced by newer
background work into one chat line; the extension SHALL NOT draw a competing
replacement line or invent a wake reason absent from the SDK event.

#### Scenario: A turn starts
- **WHEN** the service receives a `turn-started` session event for a served session
- **THEN** it records the session as running at the event time and keeps no reply preview from an earlier turn

#### Scenario: A reply is replaced by a newer reply
- **WHEN** the service receives a `turn-finished` event with `content.reply`
- **THEN** it records the session as idle with that reply as the newest preview, replacing any earlier stored reply

#### Scenario: A turn fails
- **WHEN** the service receives a `turn-failed` event with an error
- **THEN** it records the session as failed with the event's error message and no reply preview

#### Scenario: Delivery state comes from the host event
- **WHEN** no session event has been received for a session
- **THEN** the Work Status and session action show no delivery line, instead of inferring one from the status file's age

#### Scenario: Delivery state is surfaced in existing views
- **WHEN** a session has a recorded delivery state
- **THEN** the session action and Work Status show its activity and current reply or error, without changing the model-pick fields or their separate "last known" note
