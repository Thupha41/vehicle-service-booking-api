# ADR 0003: Use `tstzrange` and Exclusion Constraints

- Status: Accepted
- Date: 2026-08-28

## Context

The core invariant is temporal: the same active technician or service bay cannot be assigned to overlapping appointments. Clients send ISO-8601 timestamps with offsets, dealerships have IANA timezones, and daylight-saving changes make timezone-free timestamps unsafe. Adjacent appointments must be allowed.

An application query can find an apparently free resource, but a concurrent transaction can make that result stale before insert.

## Decision

Store appointment bounds as `timestamptz` and generate `scheduled_period` as:

```sql
tstzrange(starts_at, ends_at, '[)')
```

Enable `btree_gist` and create two partial GiST exclusion constraints. They reject overlap for the same dealership/technician or dealership/bay when status is `CONFIRMED` or `IN_PROGRESS`. Use explicit TypeORM raw SQL migrations and keep schema synchronization disabled.

Map violations of the named constraints (PostgreSQL SQLSTATE `23P01`) to `409 SLOT_CONFLICT`.

## Consequences

### Positive

- PostgreSQL guarantees the invariant across all API instances and code paths.
- `[start, end)` permits back-to-back appointments.
- `tstzrange` preserves instant semantics across timezones and daylight-saving transitions.
- Cancelling or completing a row releases capacity while retaining history.

### Negative

- The solution is intentionally PostgreSQL-specific.
- Tests need real PostgreSQL; SQLite and mocks cannot verify the guarantee.
- GiST indexes and exclusion checks add write cost and require operational monitoring.
- Changing which statuses consume capacity requires a migration.

## Alternatives considered

- **`tsrange`:** rejected because it discards timezone/offset semantics.
- **Inclusive end bounds:** rejected because appointments touching at one boundary would conflict.
- **Application-only `NOT EXISTS`:** retained as a selection optimization but rejected as the final guard because of races.
- **ORM schema synchronization/decorator only:** rejected because the extension, generated expression, partial predicate, and stable constraint names should be explicit and reviewable.

## Evolution triggers

Revisit if appointments become multi-stage, require setup/cleanup buffers, assign multiple technicians/bays, or need soft holds. Model those concepts as explicit ranges/resources and extend database-backed concurrency tests before changing the constraint policy.
