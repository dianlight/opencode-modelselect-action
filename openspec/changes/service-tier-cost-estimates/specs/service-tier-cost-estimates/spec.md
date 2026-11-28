# Spec Delta

## Purpose

Defines cost estimates from service-tier prices including long-context rates.

## ADDED Requirements

### Requirement: Tier prices
Cost estimates SHALL use service-tier prices including long-context rates.

#### Scenario: Long context
- **WHEN** a request exceeds the standard context rate
- **THEN** the estimate uses the long-context tier price

#### Scenario: Free variant
- **WHEN** the selected variant is free
- **THEN** the estimate is zero and the row remains labeled free

### Requirement: No local bounds
The store SHALL NOT use hard-coded cost bounds to guess a price.

#### Scenario: Missing estimate
- **WHEN** no host estimate is available
- **THEN** the UI shows an unknown state instead of a guessed number
