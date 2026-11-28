# Spec Delta

## Purpose

Defines plugin-managed routing automations alongside manifest schedule entries.

## ADDED Requirements

### Requirement: Automation lifecycle
The plugin SHALL be able to create, list and delete routing automations through the host API.

#### Scenario: Create
- **WHEN** the plugin registers a routing refresh automation
- **THEN** the automation is listed by the host

#### Scenario: Delete
- **WHEN** the plugin removes the automation
- **THEN** the host no longer lists it

### Requirement: Compatibility
Manifest schedule entries SHALL remain the fallback when the automation API is absent.

#### Scenario: API absent
- **WHEN** a host does not expose the automation API
- **THEN** manifest cron entries still drive refresh
