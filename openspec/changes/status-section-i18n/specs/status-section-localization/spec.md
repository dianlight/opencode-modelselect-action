# Spec Delta

## Purpose

Defines how the host-rendered Work Status section selects a display language
from the host request and keeps its schema-valid view stable when a translation
is missing.

## ADDED Requirements

### Requirement: Locale from host request

The status section SHALL use the locale the host sends on `GET /status` when
selecting its display strings.

#### Scenario: Supported locale

- **WHEN** the host requests the section with a locale that has a message table
- **THEN** labels, tooltips, badges and notes in the view use that table

#### Scenario: Unsupported locale

- **WHEN** the host requests the section with a locale that has no message table
- **THEN** the view uses the English table and remains schema-valid

#### Scenario: Missing locale

- **WHEN** the host requests the section without a locale
- **THEN** the view uses the English table

### Requirement: Data values stay verbatim

The status section SHALL localize only chrome strings and MUST leave data
values such as model ids, provider ids, task-type names and timestamps
verbatim.

#### Scenario: Mixed row content

- **WHEN** a localized row shows a model id and a label
- **THEN** the label comes from the message table and the model id is unchanged

### Requirement: Stable view contract across locales

Every locale SHALL produce the same row ids, control ids, row count and
schema-valid field lengths as the English view for the same snapshot.

#### Scenario: Locale does not change structure

- **WHEN** the same snapshot is rendered in two different locales
- **THEN** both answers pass `guestStatusViewSchema` with identical row ids and control ids

#### Scenario: Length limits are respected

- **WHEN** a translated string exceeds its field limit
- **THEN** the view truncates it within the schema limit rather than failing validation
