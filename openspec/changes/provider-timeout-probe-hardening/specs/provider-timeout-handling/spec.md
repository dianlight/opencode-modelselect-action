# Spec Delta

## Purpose

Defines provider timeout handling for quota and catalog probes.

## ADDED Requirements

### Requirement: Timeout handling
Probe failures SHALL be classified by the host provider timeout, not by local retry TTLs.

#### Scenario: Timed out provider
- **WHEN** a provider request times out
- **THEN** the probe is marked timed out without an extra local retry

#### Scenario: Slow provider
- **WHEN** a provider responds slowly but before the timeout
- **THEN** the response is used normally

### Requirement: Structured data
Fingerprint parsing SHALL remain only where the host exposes no structured quota data.

#### Scenario: Structured quota
- **WHEN** the host exposes structured quota fields
- **THEN** no response-fingerprint sniffing is applied
