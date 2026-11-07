# Spec Delta

## Purpose

Defines how the modelselect OpenCode plugin is delivered with the extension, so
one install puts it into the OpenCode OpenChamber runs, one removal takes it
out, and no second copy is loaded.

## ADDED Requirements

### Requirement: One install carries the plugin

While the extension is enabled and approved, OpenChamber SHALL load the
extension's plugin folder into the OpenCode it runs, without the user editing an
OpenCode config file.

#### Scenario: Enabling the extension
- **WHEN** the user enables the extension and approves the plugin row
- **THEN** the plugin's tools and hooks are available to the running OpenCode within seconds, with no restart

#### Scenario: Disabling or removing the extension
- **WHEN** the user disables or removes the extension
- **THEN** the plugin is no longer loaded, and the project caches it wrote stay readable

### Requirement: Exactly one entry names the plugin

The extension MUST NOT leave a second OpenCode config entry pointing at its
plugin folder, and SHALL report a pre-existing manual entry with an action that
removes it.

#### Scenario: Upgrade from a hand-installed plugin
- **WHEN** the managed config still holds the `modelselect` entry written by an earlier version
- **THEN** the extension shows a one-time notice naming the entry and offers removal
- **AND** it never removes the entry or edits the user's global config without that action

#### Scenario: Duplicate load avoided
- **WHEN** the notice has not been acted on
- **THEN** the extension states that the plugin may be loaded twice and that the older entry must be removed

### Requirement: The plugin is self-contained

The bundled plugin entry SHALL import nothing at runtime and SHALL export
`{ id, setup }`, the shape OpenCode 2 loads from a folder where no packages are
installed.

#### Scenario: Fresh machine
- **WHEN** the extension is installed from a ZIP or a git URL on a machine with no `node_modules` for the plugin
- **THEN** the plugin loads and registers its hooks

### Requirement: Standalone install keeps working

The plugin SHALL remain installable on its own, from npm or a local path, for
users who do not run the extension.

#### Scenario: No extension installed
- **WHEN** the plugin is the only component installed
- **THEN** routing, status output and cache files behave as they do today

### Requirement: Delivery limits are stated, not hidden

Where OpenChamber cannot load the extension's plugin, the extension SHALL say so
and SHALL NOT claim a working plugin.

#### Scenario: External OpenCode
- **WHEN** OpenChamber talks to an OpenCode it did not start, or one on another machine
- **THEN** the extension names the reason and the available action (add to global config, or nothing on a remote machine)

#### Scenario: Isolated space
- **WHEN** a session runs in an isolated space with its own OpenCode
- **THEN** the extension states that the plugin is absent from that session
