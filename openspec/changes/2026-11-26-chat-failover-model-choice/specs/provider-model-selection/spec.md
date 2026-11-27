# Spec Delta

## Purpose

Defines the failover contract for task → model resolution.

## MODIFIED Requirements

### Requirement: A task selects a model by id

The task configuration SHALL reference a single model id and SHALL resolve that id through the model registry. Failover SHALL move a chat only along the task's ordered candidate list and SHALL NOT relocate a chat whose chooser did not pick the failing model.

#### Scenario: Task names a model
- **WHEN** a task type references a model id
- **THEN** the selection resolves the corresponding model entry

#### Scenario: Failover stays inside the ranking
- **WHEN** the chosen model fails and a candidate from the task ranking is tried
- **THEN** the chat moves along the ranking and the user chose that candidate through the task

#### Scenario: Failover refuses an unchosen model
- **WHEN** a failure suggests a model outside the task's candidate list
- **THEN** the failure is surfaced and no chat move is performed
