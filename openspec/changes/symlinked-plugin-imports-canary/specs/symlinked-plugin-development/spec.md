# Spec Delta

## Purpose

Defines how a symlinked OpenCode TypeScript plugin resolves its own imports.

## ADDED Requirements

### Requirement: Symlink development
Local development SHALL be able to load the modelselect plugin through a symlink with its own imports resolved.

#### Scenario: Symlinked plugin
- **WHEN** the plugin directory is a symlink to the source tree
- **THEN** OpenCode loads it and resolves its relative imports

#### Scenario: Packaged plugin
- **WHEN** the plugin is bundled for release
- **THEN** the same runtime behavior is unchanged

### Requirement: Shipped bundle
Release builds SHALL remain self-contained.

#### Scenario: Release build
- **WHEN** a release bundle is built
- **THEN** it contains the plugin code and needs no source checkout
