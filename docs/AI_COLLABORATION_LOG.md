# AI Collaboration Narrative

## Purpose

AI was used as an implementation accelerator and an adversarial reviewer, not as the owner of the scheduling invariant. The human-directed lead/root workflow retained responsibility for scope, architectural choices, file ownership, verification gates, and the final submission.

This narrative records only collaboration events that occurred during this implementation. It does not reproduce private prompts, invent productivity measurements, or claim human review that did not happen.

## Collaboration workflow

### 1. Detailed plan and red-team challenge

The work started from `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md`. A dedicated red-team planning agent challenged the assumptions and decomposed the plan before implementation. That pass focused attention on the actual collision boundary—technician or bay at one dealership and period—and on verifying concurrency with PostgreSQL rather than a substitute database.

The lead/root workflow then kept the design intentionally bounded: a modular monolith, a synchronous REST contract, one PostgreSQL consistency boundary, and no message queue or cache on the booking decision path.

### 2. Non-overlapping agent ownership

Parallel work used explicit file ownership so agents could not silently overwrite one another:

| Ownership area           | Responsibility                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Lead/root implementation | Appointment transaction, idempotency behavior, allocation rules, integration of all work, and engineering decisions.      |
| Platform agent           | NestJS bootstrap, configuration, security middleware, health, logging, metrics, tracing, Swagger, and OpenAPI generation. |
| PostgreSQL test agent    | Real-database concurrency matrix and overlap assertions without changing production source.                               |
| Documentation agent      | README, system design, AI narrative, and architecture decision records after the test gate.                               |

This split was a correctness control as much as a throughput optimization. Shared interfaces were inspected, while write scopes remained separate.

### 3. Decisions retained by the lead/root workflow

AI-generated alternatives were evaluated against Scenario A rather than accepted by default. The lead/root implementation made and retained these decisions:

- Use `tstzrange`, not `tsrange`, because API timestamps carry offsets and dealerships use IANA timezones.
- Use half-open `[start, end)` intervals so adjacent appointments do not conflict.
- Put the non-overlap invariant in two PostgreSQL exclusion constraints, one for technicians and one for bays.
- Use deterministic technician-then-bay row locks with `FOR UPDATE SKIP LOCKED` to coordinate normal allocation.
- Add a transaction-scoped PostgreSQL advisory lock keyed only by the idempotency key, so concurrent retries coalesce without serializing unrelated bookings.
- Keep queues for possible post-commit work only; do not use a message queue as a substitute for the database invariant.

These choices were checked against maintainability, failure behavior, and the stated low-to-medium contention assumption before implementation proceeded.

### 4. Database-backed verification changed the code

The test phase used real PostgreSQL because range operators, GiST exclusion constraints, row locks, advisory locks, and SQLSTATE behavior cannot be proven by SQLite or mocks.

One end-to-end cancellation test exposed a concrete problem in the initial implementation's raw TypeORM handling of `UPDATE ... RETURNING`. The returned value did not have the expected appointment-row shape in that execution path. The lead/root workflow changed cancellation to run `UPDATE` and then `SELECT` the row inside the same transaction. The PostgreSQL test then verified the returned status and subsequent slot release.

This is the clearest example of ownership in the collaboration: generated code was treated as a hypothesis, an executable test found an integration-specific defect, and the implementation was refined before documentation.

The documentation pass also found that `NODE_ENV=production` implicitly enabled PostgreSQL TLS while the local Compose database did not offer TLS. The lead/root workflow replaced that implicit coupling with an explicit `DATABASE_SSL` setting, then verified the full `db -> migrate -> api` Compose lifecycle and all public operational endpoints.

### 5. Independent reviews changed the implementation

The final code-review skill ran two read-only reviewers in parallel: one against repository standards and one against the Scenario A specification. Their evidence led to concrete changes before handoff:

- Appointment orchestration was refactored to consume query/allocation ports exported by the Vehicle, Resource, and Reference Data contexts instead of querying their tables directly.
- OpenAPI response/error DTOs and examples were added, and the duplicated case-variant `Idempotency-Key` header was reduced to one contract entry.
- The PostgreSQL test helper now refuses destructive cleanup unless `NODE_ENV=test` and the database name ends in `_test`; local Compose creates a dedicated `scheduler_test` database.
- The promised PostgreSQL matrix was expanded with invalid-period/composite-FK cases, resource-unavailability cases, a 20-request burst, exclusion-to-HTTP mapping, and cross-dealership independence.
- Low-cardinality booking counters, scheduling duration histograms, and semantic scheduling spans were added.
- Migration rollback no longer removes a potentially shared `btree_gist` extension.

The dependency audit initially found advisories only in the Nest CLI build chain. Pinned transitive patched versions reduced the repeated audit to zero known advisories without changing runtime behavior.

### 6. Verification gates

The completed implementation was checked in layers:

- Unit tests cover business-hours and stable request hashing.
- Integration tests exercise PostgreSQL exclusion constraints, including overlapping and adjacent periods and cancelled rows.
- End-to-end tests cover availability, booking, retrieval, cancellation, slot reuse, idempotent replay, and stable errors.
- Concurrency tests exercise multiple technician/bay capacity matrices and same-key concurrent retries, then query PostgreSQL for overlap evidence.
- Lint, typecheck, build, migration/seed, health/observability smoke checks, and OpenAPI generation are part of the repository workflow.

No coverage percentage, elapsed-time saving, or generated-line count is asserted because those figures were not captured as verified evidence during the work.

## Human verification checklist

Before submission, the human owner should still:

1. Review the final diff and the pre-landing standards/spec findings.
2. Run the documented commands from a clean clone and disposable PostgreSQL database.
3. Exercise the cURL flow and Swagger UI with a future London business-hours timestamp.
4. Confirm the architecture diagram is described as a target AWS topology, not an already deployed environment.
5. Record the required 5-10 minute demonstration video and explain the trade-offs in their own words.

AI assisted with decomposition, repetitive implementation, adversarial checks, tests, and documentation. Accountability for accepting the design and submission remains with the human owner.
