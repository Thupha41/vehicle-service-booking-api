# Unified Service Scheduler

A production-minded implementation of Keyloop Coding Challenge Scenario A. The API checks whether a dealership has both a qualified technician and a compatible service bay for the full service duration, then books both resources atomically.

The solution deliberately targets the stated low-to-medium contention profile: NestJS and PostgreSQL run as a modular monolith, while PostgreSQL row locks and exclusion constraints protect correctness. A message queue, distributed lock, and microservices are intentionally outside the booking path.

## What is implemented

- `POST /v1/availability/check` - a non-reserving availability snapshot.
- `POST /v1/appointments` - idempotent, transactional booking.
- `GET /v1/appointments/:id` - appointment retrieval.
- `POST /v1/appointments/:id/cancel` - idempotent cancellation and slot release.
- PostgreSQL `tstzrange` values with `[start, end)` semantics.
- Database exclusion constraints for technician and service-bay overlaps.
- Swagger UI, OpenAPI JSON, health probes, Prometheus metrics, structured logs, and optional OpenTelemetry tracing.
- Unit, integration, end-to-end, and concurrent-booking tests against PostgreSQL.

## Prerequisites

- Node.js 22 or later.
- pnpm 10.30.3 through Corepack.
- Docker Desktop or another Docker Compose-compatible runtime.

## Clean setup from a clone

The local PostgreSQL container is exposed on host port `55432` to avoid colliding with an existing PostgreSQL installation on `5432`. On first initialization it creates `scheduler` for the application and a separately guarded `scheduler_test` database for destructive test isolation.

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up -d db
$env:DATABASE_URL = 'postgresql://scheduler:scheduler@localhost:55432/scheduler'
$env:DATABASE_SSL = 'false'
pnpm migration:run
pnpm seed
pnpm start:dev
```

The API is then available at `http://localhost:3000`. The TypeORM migration command reads `DATABASE_URL` directly from the process environment, so keep the PowerShell environment assignment even though `.env` also exists for the NestJS application.

Useful local endpoints:

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Liveness: `http://localhost:3000/health/live`
- Database readiness: `http://localhost:3000/health/ready`
- Prometheus metrics: `http://localhost:3000/metrics`

For a fully containerized run, Compose starts PostgreSQL, runs the migration as a one-shot service, and starts the API only after that migration succeeds. Apply the repeatable demo seed after the API container is running:

```powershell
docker compose up -d --build
docker compose exec api node dist/shared/database/seed.js
```

To stop the local stack without deleting its database volume:

```powershell
docker compose down
```

## Seed data

The seed is repeatable and creates a London dealership open Monday-Saturday from 08:00 to 17:00, two technicians, and three service-bay types. Technician shifts cover the demo horizon; normal business-hours validation still applies.

| Record        | UUID                                   | Notes                    |
| ------------- | -------------------------------------- | ------------------------ |
| Dealership    | `10000000-0000-4000-8000-000000000001` | `Europe/London`          |
| Customer      | `20000000-0000-4000-8000-000000000001` | Taylor Morgan            |
| Vehicle       | `30000000-0000-4000-8000-000000000001` | Volkswagen Golf          |
| Oil change    | `40000000-0000-4000-8000-000000000001` | 60 minutes, standard bay |
| Brake service | `40000000-0000-4000-8000-000000000002` | 90 minutes, lift bay     |
| EV diagnostic | `40000000-0000-4000-8000-000000000003` | 120 minutes, EV bay      |

## Try the API with cURL

The examples below use Bash-style variables. Replace `START_AT` with any future Monday-Saturday time that fits completely inside 08:00-17:00 in `Europe/London`. The server calculates `endsAt`; clients cannot override the configured service duration.

```bash
BASE_URL=http://localhost:3000
START_AT=2030-06-03T09:00:00+01:00
DEALERSHIP_ID=10000000-0000-4000-8000-000000000001
CUSTOMER_ID=20000000-0000-4000-8000-000000000001
VEHICLE_ID=30000000-0000-4000-8000-000000000001
SERVICE_TYPE_ID=40000000-0000-4000-8000-000000000001
```

Check availability. This is a snapshot and does not reserve resources:

```bash
curl -sS -X POST "$BASE_URL/v1/availability/check" \
  -H "Content-Type: application/json" \
  -d "{\"dealershipId\":\"$DEALERSHIP_ID\",\"vehicleId\":\"$VEHICLE_ID\",\"serviceTypeId\":\"$SERVICE_TYPE_ID\",\"desiredStartAt\":\"$START_AT\"}"
```

Book atomically. Generate a fresh UUID for each new logical request; retry the same request with the same key after a client timeout:

```bash
IDEMPOTENCY_KEY=11111111-1111-4111-8111-111111111111

curl -sS -X POST "$BASE_URL/v1/appointments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"vehicleId\":\"$VEHICLE_ID\",\"dealershipId\":\"$DEALERSHIP_ID\",\"serviceTypeId\":\"$SERVICE_TYPE_ID\",\"desiredStartAt\":\"$START_AT\"}"
```

Copy the returned `id` into `APPOINTMENT_ID`, then retrieve and cancel it:

```bash
APPOINTMENT_ID="paste-returned-appointment-uuid-here"

curl -sS "$BASE_URL/v1/appointments/$APPOINTMENT_ID"
curl -sS -X POST "$BASE_URL/v1/appointments/$APPOINTMENT_ID/cancel"
```

Cancellation is idempotent. Once the appointment is `CANCELLED`, the same resources may be booked again for that period because the exclusion constraints apply only to `CONFIRMED` and `IN_PROGRESS` rows.

## Verification

Unit tests do not need a database. Integration, end-to-end, and concurrency suites use real PostgreSQL features and must not be redirected to SQLite or an in-memory substitute.

```powershell
pnpm test:unit

$env:TEST_DATABASE_URL = 'postgresql://scheduler:scheduler@localhost:55432/scheduler_test'
pnpm test:integration
pnpm test:e2e
pnpm test:concurrency

pnpm lint
pnpm typecheck
pnpm build
pnpm openapi:generate
```

The PostgreSQL suites delete appointments from the configured test database as part of isolation. Use a disposable local/test database, never a database containing important data.

## Reliability and operational notes

- Booking uses a short `READ COMMITTED` transaction, an idempotency-key advisory transaction lock, deterministic technician-then-bay row locking with `SKIP LOCKED`, and database exclusion constraints as the final invariant.
- Request logs carry `x-request-id`; sensitive headers and selected PII fields are redacted.
- `/metrics` exposes HTTP count, active-request, latency, and Node.js process metrics.
- Set `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` to export traces through OTLP/HTTP.
- Local Compose sets `DATABASE_SSL=false`. A cloud deployment must set it to `true` and make the current database CA chain available to the container.
- The current HTTP API intentionally has no resource-management endpoints and no production authentication. Reference data and resource schedules are created by migration/seed only; production deployment must add OIDC authorization and controlled administrative workflows.

## Design documentation

- [System design](docs/SYSTEM_DESIGN.md)
- [AI collaboration narrative](docs/AI_COLLABORATION_LOG.md)
- [ADR 0001: Modular monolith](docs/adr/0001-modular-monolith.md)
- [ADR 0002: Database locking instead of a message queue](docs/adr/0002-database-locking-over-message-queue.md)
- [ADR 0003: `tstzrange` exclusion constraints](docs/adr/0003-tstzrange-exclusion-constraints.md)
- [Detailed implementation plan](docs/SCENARIO_A_IMPLEMENTATION_PLAN.md)

## Scope boundaries

This assessment implements the scheduling backend and uses Swagger/cURL as the client. Temporary holds, waitlists, payments, notifications, recurring or multi-stage jobs, a resource-administration UI, and AWS deployment automation are not included. The target production topology is documented, but this repository does not claim that it has been deployed to AWS.
