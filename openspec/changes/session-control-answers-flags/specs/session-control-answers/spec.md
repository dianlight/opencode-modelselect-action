# Spec Delta

## Purpose

Let the local OpenChamber service answer agent-initiated permission requests and computable forms on the user's behalf under independent opt-in switches.

## ADDED Requirements

### Requirement: Permission answers are opt-in

The local service SHALL answer agent-initiated permission requests only while
the session permission answer switch is enabled.

#### Scenario: Permission answered while the switch is on
- **WHEN** the user enables the session permission answer switch and the agent asks for permission
- **THEN** the service answers the request with a one-time allow

#### Scenario: Permission dropped while the switch is off
- **WHEN** the session permission answer switch is disabled and the agent asks for permission
- **THEN** the service does not answer the request

### Requirement: Form answers are opt-in with autosend

The local service SHALL answer agent-initiated form questions only while the
session form answer switch is enabled, and SHALL send the full answer including
defaults for fields it cannot compute only while the autosend sub-switch is
enabled.

#### Scenario: Form answered while the switches are on
- **WHEN** the user enables the session form answer switch and the agent asks a form question
- **THEN** the service answers with the computable values

#### Scenario: Form not answered while the switches are off
- **WHEN** the session form answer switch is disabled and the agent asks a form question
- **THEN** the service does not answer the request
