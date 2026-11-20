# Spec Delta

## Purpose

Defines how a quota provider reports its configured state under the host's
install-time validation, so a missing extension-owned key reads as a configured
provider with an error, not as an unconfigured one.

## ADDED Requirements

### Requirement: A listed provider is configured

The service SHALL report a quota provider as configured when the host lists it,
even if its extension-owned key is absent.

#### Scenario: Host credential present
- **WHEN** the host provides the credential for a listed provider
- **THEN** the row reads configured and shows the quota

#### Scenario: Extension-owned key missing
- **WHEN** the host lists the provider but the extension-owned key is absent
- **THEN** the row reads configured and its error names where to enter the key

### Requirement: Only missing OpenCode credentials are unconfigured

The service SHALL report `configured: false` only for a provider whose listed
OpenCode credential is missing, and that row SHALL send the user to OpenChamber's
Providers page.

#### Scenario: Provider absent
- **WHEN** the host does not list the provider at all
- **THEN** the row reads unconfigured and points at the Providers page
