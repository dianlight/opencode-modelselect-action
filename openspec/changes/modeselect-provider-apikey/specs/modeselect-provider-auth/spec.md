# Spec Delta

## Purpose

Resolves the Zen/Go probe token from a dedicated Modeselect provider credential
instead of relying solely on the ambient `OPENCODE_API_KEY` environment variable,
and registers that provider so users can store the key with `opencode auth login
modeselect`.

## ADDED Requirements

### Requirement: Modeselect provider credential is a token source

The plugin SHALL treat a key stored under the `modeselect` provider in OpenCode's
auth store as a valid Zen/Go probe token.

#### Scenario: Key stored for modeselect
- **WHEN** `auth.json` contains `{ "modeselect": { "type": "api", "key": "sk-mod" } }`
- **THEN** the plugin resolves the probe token to `sk-mod`

#### Scenario: No modeselect entry
- **WHEN** `auth.json` has no `modeselect` entry
- **THEN** the plugin does not resolve a token from that source

### Requirement: Modeselect key takes precedence over env var

When a Modeselect provider key is available, the plugin SHALL use it instead of
`OPENCODE_API_KEY`, regardless of whether the env var is set.

#### Scenario: Both present
- **WHEN** a Modeselect key and `OPENCODE_API_KEY` are both set
- **THEN** the probe token comes from the Modeselect key

#### Scenario: Only env var present
- **WHEN** no Modeselect key is stored but `OPENCODE_API_KEY` is set
- **THEN** the probe token comes from `OPENCODE_API_KEY`

### Requirement: Explicit option still wins

An explicit `token` (or `opencode-token`) option SHALL take precedence over both
the Modeselect provider key and the env var.

#### Scenario: Option set
- **WHEN** the `token` option is non-empty
- **THEN** the probe token comes from the option

### Requirement: Fallback to other auth providers

When no Modeselect key, env var, or explicit option is available, the plugin
SHALL fall back to the `opencode` then `opencode-go` keys in the auth store.

#### Scenario: Only opencode key present
- **WHEN** only `{ "opencode": { "type": "api", "key": "sk-zen" } }` is stored
- **THEN** the probe token comes from the `opencode` key

### Requirement: modeselect integration is registered

The plugin SHALL register a `modeselect` OpenCode integration exposing a `key`
auth method (and an `env` method naming `OPENCODE_API_KEY`) so users can run
`opencode auth login modeselect`.

#### Scenario: Integration available
- **WHEN** the plugin loads in a host that supports integration transforms
- **THEN** a `modeselect` integration with a `key` method is present

#### Scenario: Integration transform unsupported
- **WHEN** the host does not support integration transforms
- **THEN** the plugin still resolves tokens from auth.json / env and logs nothing fatal

### Requirement: Auth cache invalidation

A newly stored Modeselect key SHALL be usable after the auth cache is cleared,
without restarting the plugin process.

#### Scenario: Key added after load
- **WHEN** `clearAuthCache()` is called after a Modeselect key is stored
- **THEN** the next token resolution returns the new key
