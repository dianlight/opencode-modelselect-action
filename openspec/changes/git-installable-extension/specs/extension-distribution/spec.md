# Spec Delta

## Purpose

Define how the openchamber-modelselect extension is delivered so OpenChamber can
install it from a git URL, notice a newer version, and update it in place
without the user rebuilding or re-adding the folder.

## ADDED Requirements

### Requirement: Distributed build contents

A distributed build SHALL be installable from a git URL by OpenChamber's
extension installer, which reads `package.json` at the repository root.

#### Scenario: Repository root is the package
- **WHEN** the distribution repository is checked out
- **THEN** `package.json` sits at the root with the `openchamber` manifest block
- **AND** it names only built files that exist in the checkout: `panel/index.html`,
  `panel/main.js`, `service/main.js`
- **AND** it contains no source files, no `node_modules`, and no build tooling
  the host would have to run

#### Scenario: Version is semver and increases per release
- **WHEN** a release ships a changed extension
- **THEN** the distributed `package.json` carries a `version` newer than the
  previously published one
- **AND** the same version is recorded in this repository's `CHANGELOG.md`

### Requirement: Update detection

OpenChamber SHALL check a git-installed extension at most once an hour and offer
an update only when the distributed `version` is newer than the installed one.

#### Scenario: Newer version becomes an update prompt
- **WHEN** the distributed `version` is greater than the installed version
- **AND** the user opens Settings → Extensions or the update check runs
- **THEN** the extension's card shows "Update available" with an Update button
- **AND** pressing Update replaces the built files and keeps the user's
  approvals, accounts, and settings

#### Scenario: Unchanged version costs nothing
- **WHEN** the distributed `version` equals the installed version
- **THEN** no update is offered and no files are rewritten

### Requirement: Install without a terminal

A user SHALL be able to install the git-installable build from the extension's
documentation or from a chat link, without cloning anything.

#### Scenario: Install link from documentation
- **WHEN** the user opens the documented `openchamber://extensions/install?url=…`
  link on the desktop app
- **THEN** OpenChamber opens the add-extension dialog prefilled with that
  repository
- **AND** the permission list is shown before anything is installed

#### Scenario: Manual field still works
- **WHEN** the user pastes the same https git URL into Settings → Extensions
- **THEN** the install behaves identically, including later update checks

#### Scenario: Folder install documented as the development path
- **WHEN** the user installs the folder from a working tree
- **THEN** the README states that this path never receives update prompts and is
  replaced by hand

### Requirement: Release automation parity

The published distribution SHALL be produced from this repository's source, so
the two never diverge.

#### Scenario: Release publishes the built extension
- **WHEN** a release runs after a change under `openchamber-modelselect/`
- **THEN** the automation builds the bundles, checks them
  (`node --check`, `openchamber-guest-check`), and pushes the built package to the
  distribution repository
- **AND** a failed check stops the publish rather than shipping stale bundles
