# Spec Delta

## Purpose

Defines how extension link origins match subdomain wildcards.

## ADDED Requirements

### Requirement: Wildcard origin
The extension SHALL use subdomain wildcard origins for gateway link destinations.

#### Scenario: Gateway subdomain
- **WHEN** a pick links to a gateway subdomain
- **THEN** the origin validates and the link opens

#### Scenario: Exact origin
- **WHEN** a destination declares an exact origin
- **THEN** only that exact host matches

### Requirement: No per-host list
The extension SHALL NOT require one manifest entry per gateway subdomain.

#### Scenario: New subdomain
- **WHEN** a new gateway subdomain appears
- **THEN** the existing wildcard covers it with no manifest change
