# Spec Delta

## Purpose

Defines how the extension tracks the stable 2.8.1 SDK surface.

## ADDED Requirements

### Requirement: Stable parity
The extension SHALL declare and verify parity with the stable 2.8.1 SDK surface.

#### Scenario: Supported version
- **WHEN** the host runs OpenChamber 2.8.1 or newer
- **THEN** the declared SDK floor is satisfied and the manifest validates

#### Scenario: Older host
- **WHEN** the host runs below 2.8.1
- **THEN** the manifest reports an unsupported engine version

### Requirement: Supersession
The 2.7.3 audit SHALL be treated as superseded by this stable audit.

#### Scenario: Stale spec reference
- **WHEN** documentation cites the 2.7.3 audit as current
- **THEN** it is updated to cite this audit
