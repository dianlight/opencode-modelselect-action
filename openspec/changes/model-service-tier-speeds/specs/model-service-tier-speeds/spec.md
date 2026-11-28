# Spec Delta

## Purpose

Defines service-tier speeds as remembered host state instead of separate model picker rows.

## ADDED Requirements

### Requirement: Remembered speeds
The picker SHALL use the host's remembered service-tier speeds for known tiers.

#### Scenario: Known tier
- **WHEN** a model has a remembered speed
- **THEN** the picker shows that speed without a suffixed model row

#### Scenario: Unknown tier
- **WHEN** no remembered speed exists
- **THEN** the canonical model is shown without an invented tier

### Requirement: No synthetic rows
The extension SHALL NOT create picker rows by appending `contributor`, `unlimited` or `free` suffixes to a canonical id.

#### Scenario: Suffixed config entry
- **WHEN** the config lists a suffixed variant
- **THEN** canonicalization strips it and no duplicate row is rendered
