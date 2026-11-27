# provider-model-selection Specification

## Purpose
Defines how a task resolves a model variant across providers at runtime, through a task -> model id, per-model free/non-free variants and provider availability.

## Requirements

### Requirement: A task selects a model by id

The task configuration SHALL reference a single model id and SHALL resolve that id through the model registry.

#### Scenario: Task names a model
- **WHEN** a task type references a model id
- **THEN** the selection resolves the corresponding model entry

### Requirement: A model carries free and paid variants

A model entry SHALL list its free and non-free variants across providers, each with its cost.

#### Scenario: Free variant lookup
- **WHEN** a task resolves with a free-first preference
- **THEN** the chosen variant is the free one

### Requirement: Runtime selection orders variants

The runtime selection SHALL order variants by free-first or go-first preference and SHALL prefer an engine provider variant over an external provider variant on equal cost and score.

#### Scenario: Equal factors
- **WHEN** cost and score are equal
- **THEN** the engine provider variant is chosen before external provider variants

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
