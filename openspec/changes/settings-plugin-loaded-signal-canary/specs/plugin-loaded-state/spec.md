# Spec Delta

## Purpose

Defines how the extension learns from Settings that the OpenCode plugin is already loaded.

## ADDED Requirements

### Requirement: Loaded state
The extension SHALL use the host's loaded-plugin signal to decide whether to offer plugin setup.

#### Scenario: Plugin already loaded
- **WHEN** the host reports the plugin as loaded
- **THEN** the Models tab does not offer to add it again

#### Scenario: Plugin missing
- **WHEN** the host reports no plugin
- **THEN** the Models tab offers the setup action

### Requirement: No config sniffing
The extension SHALL NOT parse the managed OpenCode config to infer plugin state.

#### Scenario: Config mentions plugin in a comment
- **WHEN** a comment contains `modelselect` but the host reports no plugin
- **THEN** the setup action is still offered
