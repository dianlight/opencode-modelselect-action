# Spec Delta

## Purpose

Defines where the modelselect plugin's options live, which source wins when the
same key is set twice, how a saved change reaches a running OpenCode, and how
secrets stay out of the panel.

## ADDED Requirements

### Requirement: One file carries the options

The plugin SHALL read its options from `~/.config/openchamber/modelselect.json`,
accepting every option key the config entry accepts, and SHALL treat a key the
file sets as authoritative over the same key in the config entry.

#### Scenario: A key in both places
- **WHEN** `tier` is `go` in the file and `free` in the config entry
- **THEN** the plugin uses `go`

#### Scenario: A key only in the entry
- **WHEN** `maxCost` appears only in the config entry
- **THEN** the plugin uses it exactly as before

#### Scenario: No file
- **WHEN** the file is missing or unreadable
- **THEN** the plugin runs on the config entry alone and writes no error to the user

### Requirement: A saved change applies on the next turn

A settings change SHALL take effect without restarting OpenChamber and without
calling an OpenCode endpoint.

#### Scenario: Saving in the panel
- **WHEN** the user saves a changed option
- **THEN** the panel reports the change as applied on the next turn
- **AND** no request is made to a guessed port or to `/api/location/reload`

#### Scenario: Editing the file by hand
- **WHEN** the user edits the file while OpenCode runs
- **THEN** the next turn uses the new value once the file's mtime changes

### Requirement: Secrets stay write-only

The panel SHALL write `token` and `jevToken` to the file without ever rendering
a stored value back, and the file SHALL be created readable by the user only.

#### Scenario: Reopening the panel
- **WHEN** the panel loads a file that holds a token
- **THEN** the field is blank, saving an empty field keeps the stored value, and the stored value is never sent to the panel

### Requirement: Migration is additive

Existing option values SHALL be copied into the file on the first save and the
existing config entry SHALL NOT be rewritten or removed by this change.

#### Scenario: First save after upgrade
- **WHEN** the file does not exist yet and the managed entry holds options
- **THEN** the file is created with the entry's values plus the change the user made
- **AND** the entry keeps its content byte for byte

### Requirement: No endpoint guessing remains

The extension MUST NOT probe a port or call an OpenCode HTTP endpoint to apply
configuration.

#### Scenario: Closed OpenCode
- **WHEN** OpenCode is not listening on any expected port
- **THEN** saving still succeeds and nothing is reported as failed
