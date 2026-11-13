# Spec Delta

## Purpose

Ships the project's model-routing knowledge to OpenChamber users and agents as
an extension-provided skill, so the task-type mapping and the Work Status
section are discoverable inside the host.

## ADDED Requirements

### Requirement: The extension ships a modelselect skill folder

The extension SHALL declare `contributes.skills` pointing at a `skills/` folder
in its package, containing a `modelselect/SKILL.md` skill.

#### Scenario: The host lists the skill while the extension is enabled

- **WHEN** the extension is installed, approved and enabled
- **THEN** OpenChamber lists `modelselect` among the project's skills from the
  managed OpenCode config

#### Scenario: The skill folder is present in the package

- **WHEN** the extension package is inspected
- **THEN** `skills/modelselect/SKILL.md` exists and parses as a skill

### Requirement: The skill teaches the routing mapping and the status surface

The skill SHALL describe the task-type → model mapping used by the plugin, how
a turn is routed, and how to read the Work Status section and the settings
panel.

#### Scenario: An agent reads the skill before routing

- **WHEN** an agent is asked to pick a model for a task type
- **THEN** the skill text tells it which task type maps to which model class
  and where the current pick is shown

### Requirement: The skill text stays in sync with the routing config

The skill SHALL be updated in the same change that changes the task-type
mapping in `config/task-types.yaml` or the status section's rows.

#### Scenario: A task type is added to the routing config

- **WHEN** a change adds a task type to `config/task-types.yaml`
- **THEN** the change also updates `skills/modelselect/SKILL.md` to mention it

### Requirement: The skill is documented in the extension README

The README SHALL name the shipped skill and what it covers.

#### Scenario: A user reads the extension README

- **WHEN** the user opens `openchamber-modelselect/README.md`
- **THEN** the README lists the `modelselect` skill and its purpose
