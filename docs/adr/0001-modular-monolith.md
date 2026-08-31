# ADR 0001: Use a Modular Monolith

- Status: Accepted
- Date: 2026-08-28

## Context

Scenario A needs atomic allocation of an appointment, technician, and service bay. It also asks for maintainability and future scale, but provides no evidence that independently deployed services are required. Splitting the first version into services would introduce network contracts, partial failures, distributed tracing, and a cross-service consistency problem around one booking decision.

## Decision

Implement one stateless NestJS deployable with bounded modules for Appointment, Vehicle, Resource, Reference Data, Health, and shared operational concerns. Apply Clean Architecture-light boundaries inside each module and keep PostgreSQL as the single transactional consistency boundary.

Do not add an event bus, separate CQRS read database, or service-to-service calls in the MVP. Modules own their tables and expose narrow application operations even though they share a process and database.

## Consequences

### Positive

- Appointment and both resources commit atomically.
- Local development, deployment, testing, and debugging remain simple.
- Context ownership creates seams for later extraction.
- Stateless API instances can still scale horizontally behind a load balancer.

### Negative

- All modules share one deployment cadence and PostgreSQL writer.
- Poorly governed direct table access could erode module boundaries.
- A hotspot in one context can affect the shared process or database.

## Alternatives considered

- **Microservices now:** rejected because the consistency and operational cost is not justified by measured demand.
- **Full CQRS/event sourcing:** rejected because Scenario A needs a small synchronous command/query surface, not duplicated models and event replay.
- **Unstructured single module:** rejected because it would make future ownership and extraction harder without reducing much present complexity.

## Evolution triggers

Revisit when separate teams require independent release ownership, one context has materially different scaling or compliance needs, or measured workload isolation cannot be achieved within the modular monolith. Extraction must preserve a single authoritative allocation boundary.
