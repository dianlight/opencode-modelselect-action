# Spec Delta

## Purpose

Defines how a session lead agrees a model with the user before delegating work to subagents.

## ADDED Requirements

### Requirement: Agreement before dispatch
The lead SHALL obtain an explicit model agreement with the user before handing work to a subagent.

#### Scenario: Lead dispatches work
- **WHEN** the lead is about to hand work to a subagent
- **THEN** the lead asks the user to agree a model through modelselect first

#### Scenario: Agreement missing
- **WHEN** no agreement has been recorded for the lead session
- **THEN** the lead holds the dispatch and offers the model picker

### Requirement: No implicit inference
Delegated routing SHALL NOT infer a model from prompt text, acknowledgement words or injected annotations.

#### Scenario: Prompt names a model
- **WHEN** a prompt contains a model name without a recorded agreement
- **THEN** routing uses the agreed session model

#### Scenario: Legacy annotation
- **WHEN** a turn contains a `[modelselect: …]` annotation
- **THEN** routing ignores the annotation
