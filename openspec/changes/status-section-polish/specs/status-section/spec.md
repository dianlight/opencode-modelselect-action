# Spec Delta

## Purpose

Defines what the Work Status section shows, in which order, what it drops when
the host's row budget is exceeded, and how its switch is presented.

## ADDED Requirements

### Requirement: The answer never exceeds sixteen rows

The service SHALL cap its answer at 16 rows and SHALL drop optional rows in a
documented order before any row that carries the pick.

#### Scenario: Full budget
- **WHEN** the computed answer would be 18 rows
- **THEN** the two lowest-priority rows are omitted and the pick row is present

#### Scenario: Many budgets
- **WHEN** five Console budgets each report models and the cap is reached
- **THEN** budget rows are admitted in budget order and notes are dropped before any budget row

### Requirement: The router switch is a header control

The auto-update router SHALL be a two-option header control on the section,
not a row, and a change SHALL be answered and reflected in the next reading.

#### Scenario: Toggling the switch
- **WHEN** the user turns the router switch off
- **THEN** the service persists the change, answers 2xx, and the following reading shows it off

#### Scenario: Section collapsed
- **WHEN** the section is collapsed
- **THEN** the switch is still reachable in the header

### Requirement: Every row carries a known icon

Each line SHALL include an icon from a fixed list of Remixicon names; a name not
on the list SHALL be omitted rather than sent.

#### Scenario: Unknown icon
- **WHEN** a row's icon name is not on the list
- **THEN** the row is sent without an `icon` field and the answer still validates

### Requirement: The Go window shows a trend

The Go monthly row SHALL show the consumed percentage plus a sparkline of the
last readings, bounded to 120 points and rebuilt after a restart.

#### Scenario: Readings accumulate
- **WHEN** five readings have been served
- **THEN** the chart carries five values, oldest first, in the same unit as the bar

#### Scenario: Service restarted
- **WHEN** the service starts again
- **THEN** the chart carries the readings collected since the restart only

### Requirement: The answer is validated before it is served

The service's tests SHALL check a generated answer against
`guestStatusViewSchema`.

#### Scenario: A row that would be refused
- **WHEN** a field carries a value outside the schema
- **THEN** the test fails, and no such answer can be released
