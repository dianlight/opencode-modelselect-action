# Spec Delta

## Purpose

Defines how routing state is cleaned up when a user removes a provider from Settings.

## ADDED Requirements

### Requirement: Removal cleanup
The extension SHALL purge provider-scoped routing, quota and catalog state when the provider is removed from Settings.

#### Scenario: Provider removed
- **WHEN** Settings removes a provider that had cached routes
- **THEN** the cached routes, logos and quota windows for that provider are gone

#### Scenario: Unrelated provider
- **WHEN** a different provider is removed
- **THEN** the remaining providers' state is unchanged

### Requirement: Pick recovery
A pick that referenced the removed provider SHALL resolve to the next valid provider for the same model id.

#### Scenario: Removed provider was primary
- **WHEN** the chosen variant belongs to the removed provider
- **THEN** the next valid provider variant is chosen without changing the task model
