# Spec Delta

## Purpose

Defines how private extensions install and update from private-network Git hosts and SSH aliases.

## ADDED Requirements

### Requirement: Private source support
The project SHALL document private-network Git hosts, SSH aliases and account-selected HTTPS as supported extension sources.

#### Scenario: SSH alias
- **WHEN** a developer installs from an SSH alias on a private host
- **THEN** the documented setup works without rewriting the alias

#### Scenario: HTTPS with account
- **WHEN** a developer installs over HTTPS with a selected GitHub account
- **THEN** the account is used and no token is written into the bundle

### Requirement: No credential leakage
Documentation SHALL NOT require credentials inside committed or bundled files.

#### Scenario: Bundled artifact
- **WHEN** a bundle is built from a private source
- **THEN** the bundle contains no credential or private token
