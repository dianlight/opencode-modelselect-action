# Spec Delta

## Purpose

Defines how the host-rendered status section uses row icons and header controls
so its fixed 16-row budget is spent on information rather than on controls.

## ADDED Requirements

### Requirement: Recognizable row icons

Each fixed status line row SHALL carry an icon name matching the SDK's icon
pattern, and rows without a meaningful icon MUST remain valid without one.

#### Scenario: Fixed rows carry icons

- **WHEN** a project has a routed pick
- **THEN** the task, tier, model, think, source and updated rows each include a valid icon name

#### Scenario: Icon name is schema-valid

- **WHEN** any row sets an icon
- **THEN** the icon matches `^[a-z0-9][a-z0-9-]{0,39}$` and the view passes `guestStatusViewSchema`

### Requirement: Router control in the header

The router-sync switch SHALL be exposed as a header control instead of consuming
a row, keeping the control id `routing-sync` and the values `on` and `off`.

#### Scenario: Header control replaces the row

- **WHEN** the section is rendered for an open project
- **THEN** the view has a `controls` select with id `routing-sync` and no row owns a `routing-sync` segmented control

#### Scenario: Control event still applies

- **WHEN** the user selects `off` in the header control
- **THEN** the service accepts the `routing-sync` control event and pauses router updates as before

### Requirement: Row budget

The section SHALL keep the row count within the SDK cap and MUST NOT let the
router control reduce the space available to budget and latch rows.

#### Scenario: Many budget rows

- **WHEN** usage data contains more budget windows than fit
- **THEN** the view emits at most the SDK row maximum and the header control is still present

#### Scenario: Unique control ids

- **WHEN** the header control and a row action coexist
- **THEN** all control ids in the view remain unique
