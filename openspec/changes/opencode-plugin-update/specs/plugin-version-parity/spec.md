# Spec Delta

## Purpose

Defines how the extension detects that the modelselect plugin loaded by
OpenCode differs from the one it bundles, and how that state reaches the user.

## ADDED Requirements

### Requirement: Version comparison

The extension SHALL compare the loaded modelselect plugin version with its
bundled version and classify the result as matching, mismatching or missing.

#### Scenario: Versions match

- **WHEN** OpenCode loads the same plugin version the extension bundles
- **THEN** the Models tab reports no version issue

#### Scenario: Versions differ

- **WHEN** OpenCode loads a different plugin version
- **THEN** the Models tab shows both versions and identifies the state as a mismatch

#### Scenario: Plugin not loaded

- **WHEN** no modelselect plugin entry is present in the managed config
- **THEN** the Models tab reports the plugin as missing without claiming a version mismatch

### Requirement: Non-blocking notice

A version mismatch SHALL be reported without disabling the Models tab or
blocking model selection.

#### Scenario: Mismatch with usable data

- **WHEN** a mismatch is reported and routing data is available
- **THEN** the Models tab still shows the model rows and the notice is dismissible

#### Scenario: Update guidance

- **WHEN** a mismatch is shown
- **THEN** the notice points to OpenCode's plugin update action
