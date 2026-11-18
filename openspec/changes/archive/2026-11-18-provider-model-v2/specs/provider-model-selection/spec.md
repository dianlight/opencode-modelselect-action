# Spec Delta

## Purpose

Defines how a task resolves a model variant across providers at runtime, through a task -> model id, per-model free/non-free variants and provider availability.

## ADDED Requirements

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
