# Spec Delta

## Purpose

Defines model defaults and actions scoped to a sidebar folder and inherited by its children.

## ADDED Requirements

### Requirement: Folder defaults
The extension SHALL store model, thinking and agent defaults against a folder and apply them to descendant sessions.

#### Scenario: Descendant session
- **WHEN** a session starts inside a folder with a default
- **THEN** the session inherits that folder's model, thinking and agent

#### Scenario: Session override
- **WHEN** a session has its own pick
- **THEN** the session pick wins over the folder default

### Requirement: Action
The extension SHALL expose a folder action that applies defaults to the folder subtree.

#### Scenario: Apply to folder
- **WHEN** the user runs the folder model action
- **THEN** every descendant session without its own pick adopts the folder default
