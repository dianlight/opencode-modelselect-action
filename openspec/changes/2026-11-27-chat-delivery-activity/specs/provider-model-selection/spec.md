# Spec Delta

## Purpose

Adds the chat delivery state requirement to the provider-model-selection
capability, adopted from the host delivery surfaces shipped in OpenChamber 2.8.1.

## ADDED Requirements

### Requirement: A chat exposes delivery state

The runtime selection SHALL expose delivery state for a chat, including replies
that a newer reply replaced after background work.

#### Scenario: Reply replaced after background work
- **WHEN** a reply is replaced by a newer reply after background work
- **THEN** the chat folds the exchange into one line that says what woke the agent

#### Scenario: Delivery state comes from the host event
- **WHEN** the host emits a delivery or activity event
- **THEN** the surfaced state is derived from that event instead of local heuristics
