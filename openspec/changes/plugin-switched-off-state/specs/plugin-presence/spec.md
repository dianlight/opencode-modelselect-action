# Spec Delta

## Purpose

Defines how the extension reports whether the modelselect plugin is actually
running, so a switched-off or failed plugin is never presented as a live one.

## ADDED Requirements

### Requirement: Presence is one explicit state

The extension SHALL report exactly one presence state per answer, from
`running`, `stale`, `not-running`, `not-delivered`, `no-pick`, or
`legacy-entry-missing`.

#### Scenario: Two pieces of evidence disagree
- **WHEN** a fresh pick exists while delivery reports `none`
- **THEN** the state is `running` and the delivery limit is named separately, because a pick proves the plugin ran

### Requirement: Running requires a fresh pick

The extension SHALL NOT report `running` without a pick written within ten
minutes.

#### Scenario: Old pick
- **WHEN** the newest pick is 40 minutes old
- **THEN** the state is `stale` and the `Updated` row shows "last known" with its age

#### Scenario: No pick ever
- **WHEN** the plugin is installed and no status file exists
- **THEN** the state is `not-running` with no timestamp invented

### Requirement: A non-running state names the causes

The extension SHALL name the plausible causes in the order most likely first and
SHALL point at the place the user can check, without asserting one cause as
fact.

#### Scenario: Switched off or failed to load
- **WHEN** delivery is `file` and a session is active with no pick written
- **THEN** the message says the plugin is not producing picks, names Settings → Plugins as the first thing to check, and mentions a failed load as the other possibility

#### Scenario: Not delivered here
- **WHEN** delivery is `restart`, `none` or `remote`
- **THEN** the message names that limitation instead of blaming the plugin

### Requirement: Presence recovers without a restart

The state SHALL be recomputed on every answer, and a fresh pick SHALL clear any
non-running state on the next answer.

#### Scenario: Plugin switched back on
- **WHEN** the user enables the plugin again and a turn routes
- **THEN** the next answer reports `running` with the new pick

### Requirement: No new access is needed

Presence SHALL be derived only from the status files, the host's delivery state,
and the reads the extension is already granted; the extension MUST NOT read
OpenChamber's own configuration or plugin list.

#### Scenario: Extension without the OpenCode role
- **WHEN** the `opencode` role is not granted
- **THEN** presence is computed from delivery and status files alone and no state claims more than that evidence supports
