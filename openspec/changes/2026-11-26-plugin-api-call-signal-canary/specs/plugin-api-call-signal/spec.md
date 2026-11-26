# Spec Delta

## Purpose

Defines how Promise plugin API calls handle abort signals.

## ADDED Requirements

### Requirement: Promise plugin API calls honor the call signal

A Promise plugin API call SHALL accept a caller-provided signal and SHALL reject
the call when the signal is aborted.

#### Scenario: Abort before completion
- **WHEN** the caller aborts the call before it completes
- **THEN** the call rejects instead of continuing
