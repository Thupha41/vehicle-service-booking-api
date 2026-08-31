# ADR 0002: Use Database Coordination Instead of a Message Queue

- Status: Accepted
- Date: 2026-08-28

## Context

The booking endpoint must synchronously tell a client whether a technician and bay were committed. Under the assumed low-to-medium dealership contention, conflicts are localized by dealership, resource, and time. A queue would add partitioning, ordering, retry, poison-message, and response-latency concerns, but would not itself enforce the PostgreSQL overlap invariant.

Concurrent retries of the same idempotency key also need deterministic coalescing across stateless API instances.

## Decision

Use one short PostgreSQL `READ COMMITTED` transaction for booking:

1. Acquire a transaction-scoped advisory lock derived from the idempotency key.
2. Return the existing appointment for a same-key/same-payload replay, or reject a different payload.
3. Validate scheduling context.
4. Lock a qualified technician and then a compatible bay using `FOR UPDATE SKIP LOCKED`.
5. Insert the appointment and let exclusion constraints provide the final overlap guarantee.

The advisory lock is scoped to request idempotency; it is not a distributed slot lock. Do not put a message queue on the booking confirmation path.

## Consequences

### Positive

- The HTTP success response corresponds directly to a committed transaction.
- Competing API instances share one correctness mechanism.
- Idempotent retries do not create duplicate appointments.
- The operating model has fewer services and failure modes.

### Negative

- Throughput is bounded by PostgreSQL connections, lock behavior, and writer capacity.
- `SKIP LOCKED` may return a conflict while a candidate is transiently locked instead of waiting.
- Transient database failures surface to clients, which must retry with the same idempotency key.

## Alternatives considered

- **SQS/RabbitMQ/Kafka on the critical path:** rejected because asynchronous serialization does not replace the database invariant and complicates synchronous confirmation.
- **Redis/distributed lock:** rejected because it creates a second consistency system and lock/database failure-ordering problems.
- **Application-only overlap check:** rejected because two instances can race between read and insert.

## Evolution triggers

Add a transactional outbox and queue for post-commit notifications, CRM synchronization, or analytics. Revisit allocation coordination only when measured lock waits, conflicts, or writer saturation violate service objectives; retain a database-enforced final invariant.
