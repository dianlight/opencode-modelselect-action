# Spec Delta

## Purpose

Defines how model-selection Markdown commands preserve thinking variants.

## ADDED Requirements

### Requirement: Variant preserved
A model-selection Markdown command SHALL keep `variant` next to `model` when a thinking hint exists.

#### Scenario: Thinking task
- **WHEN** a task has a thinking hint
- **THEN** the command frontmatter contains both `model` and `variant`

#### Scenario: No thinking hint
- **WHEN** a task has no thinking hint
- **THEN** the command omits `variant` without dropping `model`

### Requirement: Regression check
The shipped command SHALL be checked against a fixture that fails if `variant` is dropped.

#### Scenario: Variant removed
- **WHEN** a commit removes `variant` from the command
- **THEN** the check fails
