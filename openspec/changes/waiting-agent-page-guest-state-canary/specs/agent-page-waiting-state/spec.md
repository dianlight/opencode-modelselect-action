# Spec Delta

## Purpose

Defines how a guest extension sees a session waiting on an agent page as waiting on the user.

## ADDED Requirements

### Requirement: Waiting state
The extension SHALL treat a session waiting on an agent page as waiting on the user when the host reports it.

#### Scenario: Agent page open
- **WHEN** the host reports waiting on an agent page
- **THEN** the Work Status shows a pending request for the user

#### Scenario: Other pending state
- **WHEN** the host reports a different pending state
- **THEN** the existing pending-request behavior is unchanged

### Requirement: No key sniffing
The extension SHALL NOT rely on injected page text or field-key regexes to detect that waiting state.

#### Scenario: Unrecognized field
- **WHEN** a form field name is not in `FIELD_KEYS`
- **THEN** the host state still drives the pending indicator
