# KAN-11 — Observability: Distributed Tracing

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-11
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

A single request can span HTTP handling and multiple database calls; without a trace, attributing latency or failure to a specific step means guessing from logs alone. The ticket was written as a fresh-start backlog item ("no tracing exists yet"), but this codebase already has running code in this area (`src/shared/observability/telemetry.ts`, wired from `src/main.ts`, plus manual spans in `metrics.service.ts` and `appointments.service.ts`). This plan grounds the ticket against that real code before proposing changes.

## 2. Scope

### In scope

- Verify KAN-11's three acceptance criteria against the current implementation.
- Confirm tracing is genuinely toggleable and non-blocking at both startup and shutdown, by reading `telemetry.ts` in full (not inferring from function names).
- Confirm the HTTP-entry-to-database-call span claim is real end-to-end for the write path (booking) and read/check path (availability), not just a capability declared on `MetricsService` but never invoked from a request-handling code path.
- Confirm the log/trace correlation AC by re-checking `logging.ts`'s `traceId` field against the same OTel API `telemetry.ts` and `metrics.service.ts` use.

### Explicitly out of scope

- Standing up the tracing backend/collector itself — KAN-11 marks this out of scope explicitly.
- Adding manual spans to every database call in the codebase (e.g. `getById`, `cancel` in `appointments.service.ts`, which currently have no manual `withSchedulingSpan` wrapper) — see Section 4 for why this doesn't leave a real AC gap; auto-instrumentation already covers these at the HTTP/DB layer.
- Changing `OTEL_ENABLED`'s default (`false`) — that's a separate product/ops decision about whether tracing runs by default in each environment, not something KAN-11's acceptance criteria require.

## 3. Assumptions

- "Auto-instrumentation... spanning HTTP entry through database calls" is satisfied by `@opentelemetry/auto-instrumentations-node` (which bundles HTTP/Express and `pg` instrumentation, both used by this app) providing baseline span coverage for every request and every database call automatically, with the manual `withSchedulingSpan` calls in `appointments.service.ts` layered on top as *additional* business-semantic spans (`availability.check`, `appointment.book`, `appointment.book.transaction`) — not as the sole source of DB-call tracing. This reading is checked directly in Section 4 rather than assumed.
- "Never blocks startup/shutdown if collector unreachable" is evaluated against `telemetry.ts`'s actual `sdk.start()` and `sdk.shutdown()` calls, not against `OTEL_ENABLED=false` simply skipping the whole subsystem (which would trivially satisfy "non-blocking" without proving the claim for the enabled case).

## 4. Current behaviour

All three acceptance criteria are already implemented:

- **Toggleable via config, wired from `main.ts`:** `startTelemetry()` (`src/shared/observability/telemetry.ts:10-28`) returns `undefined` immediately if `process.env.OTEL_ENABLED !== 'true'` (`:11-13`) — tracing is fully inert unless explicitly enabled. `src/main.ts:8` calls `startTelemetry()` as the very first line of `bootstrap()`, before any Nest module loads, and `src/main.ts:49` calls `registerTelemetryShutdown(telemetry)` near the end of bootstrap, after `app.enableShutdownHooks()` (`:38`). `src/shared/config/environment.ts` defines `OTEL_ENABLED` (defaults `false`, `:105`), `OTEL_SERVICE_NAME` (defaults `'unified-service-scheduler'`, `:106-110`), and `OTEL_EXPORTER_OTLP_ENDPOINT` (defaults `'http://localhost:4318'`, `:111-115`) via `validateEnvironment`, matching the "toggleable via config" AC exactly.
- **Startup is not blocked by an unreachable collector:** `startTelemetry()` calls `sdk.start()` (`telemetry.ts:26`) synchronously and returns; `NodeSDK.start()` initializes the SDK and registers the OTLP exporter but does not perform a network round-trip to the collector as part of startup — span export happens asynchronously, on a batch/flush interval, after the app is already serving traffic. Nothing in `bootstrap()` awaits a network call to the collector before `app.listen(...)` (`main.ts:50`) runs, so an unreachable collector at boot time cannot block startup.
- **Shutdown is not blocked by an unreachable collector:** `registerTelemetryShutdown()` (`telemetry.ts:30-43`) registers `SIGTERM`/`SIGINT` handlers that call `telemetry.shutdown().catch(() => { /* Process shutdown must not be blocked by an unavailable collector. */ })` (`:36-38`) — the `.catch()` explicitly swallows a failed/timed-out flush-on-shutdown so the process exit isn't held open waiting on a collector that will never respond. This was verified by reading the full file, not inferred from the function name.
- **Trace spans HTTP entry through database calls (write path):** `AppointmentsService.book()` (`src/modules/appointments/application/appointments.service.ts:84-100`) wraps the entire booking operation in `this.metrics.withSchedulingSpan('appointment.book', ...)` (`:86`), and inside that, wraps the actual transactional database work in a nested `withSchedulingSpan('appointment.book.transaction', ...)` (`:90`) around `bookInTransaction(...)` (`:91-94`), whose body (`:195-291`) issues every real database call for the booking write path: the advisory lock (`:206`), idempotency-replay lookup (`:207`), customer/vehicle existence checks (`:219-220`), technician/bay lookup-and-lock (`:248-260`), and the final `INSERT ... RETURNING *` (`:266-287`). `withSchedulingSpan` itself (`metrics.service.ts:148-164`) calls `this.tracer.startActiveSpan(name, ...)`, so this is a genuine OTel span, not just a metrics timer with a confusing name. `AppointmentsService.checkAvailability()` (`:70-82`) similarly wraps `checkAvailabilityCore()` (`:154-193`, which issues its own DB reads via `this.dataSource.manager` and `this.resources.findAvailableResourceIds`) in a `'availability.check'` span. Both of these manual spans sit *inside* the automatic HTTP-entry span that `@opentelemetry/auto-instrumentations-node`'s Express/HTTP instrumentation creates for the request (`telemetry.ts:19-22`, `getNodeAutoInstrumentations(...)`, `@opentelemetry/instrumentation-express` and `@opentelemetry/instrumentation-http` are part of that bundle), and that bundle also includes `@opentelemetry/instrumentation-pg`, which auto-instruments every `pg` query this app's TypeORM `DataSource` issues (this app uses `pg` as its driver, confirmed in `package.json`) — so the two `getById`/`cancel` methods that have *no* manual `withSchedulingSpan` wrapper (`appointments.service.ts:102-152`) still get automatic child spans for their database calls via `pg` auto-instrumentation, even without a hand-written span. The manual spans add business-semantic names on top of that automatic baseline for the two highest-value operations (booking, availability); they are not the only mechanism providing HTTP-to-DB span coverage.
- **Log/trace correlation:** `logging.ts:81-86`'s `customProps` includes `traceId: trace.getSpan(context.active())?.spanContext().traceId` on every log line — the exact same `@opentelemetry/api` `trace`/`context` calls `telemetry.ts` (via the SDK it starts) and `metrics.service.ts:30` (`trace.getTracer(...)`) operate on, so a log line emitted while a span is active carries that span's real trace ID, not a separately generated correlation ID. `GlobalExceptionFilter` does the same for error responses (`global-exception.filter.ts:38`, `error-body.ts:66`), so a traced request's error response, its server-side log line, and its trace all share one ID.

**No gap found.** All three acceptance criteria are satisfied by code that was read in full, not assumed from naming.

## 5. Proposed approach

**DONE.** No code change is needed. `telemetry.ts`'s toggle-and-non-blocking behavior, the manual+automatic span coverage on the booking and availability paths, and the trace-ID/log correlation all satisfy KAN-11's acceptance criteria as written. The one action worth taking is producing the evidence artifacts KAN-11's own ticket asks for (a sample trace, demonstrated log/trace correlation) via a manual verification run, since neither currently has a captured artifact in the repo.

## 6. Alternatives considered and rejected

**Add `withSchedulingSpan` wrappers to `getById` and `cancel`** — considered, then rejected as unnecessary for closing an AC gap: Section 4 established that `pg` auto-instrumentation already produces DB-call spans for these two methods without a manual wrapper, so the "trace spans from HTTP entry through the database calls it makes" AC is already satisfied for every endpoint, not just the two with manual spans. Adding manual spans to the remaining methods would improve trace *readability* (named spans vs. generic `pg.query` spans) but is a polish item, not a gap-closing one — noted as an open question (Section 12) rather than folded into this plan's scope, to avoid inflating a done ticket into a cosmetic refactor.

**Write an automated integration test that boots the app with `OTEL_ENABLED=true`, an in-memory span exporter, and asserts a captured span tree** — considered as a way to produce durable "sample trace" evidence. Not included in this plan's work breakdown: it would require swapping the real `OTLPTraceExporter` for an `InMemorySpanExporter` in test setup, which is a testing-infrastructure investment KAN-11's Evidence line doesn't strictly require (a manually captured trace, e.g. from a local Jaeger/Tempo instance with `OTEL_ENABLED=true`, satisfies "a sample trace showing the full request path" without new test code). Flagged in Section 12 for whoever wants stronger regression protection on tracing behavior specifically.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Manual verification run: set `OTEL_ENABLED=true` with a local OTLP-compatible collector (e.g. Jaeger), issue a booking request, capture the resulting trace showing HTTP entry → `appointment.book` → `appointment.book.transaction` → `pg` query spans, and capture the corresponding log line's `traceId` for comparison | none (evidence artifact only, attached to the Jira ticket) | none | 0.25d |

Total: negligible. No code or test files touched.

## 8. Data & migration impact

None. No schema, entity, or migration touched.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `pg` auto-instrumentation's DB-call spans are less readable than a hand-written span name, making Section 6's "no gap" claim technically true but operationally weaker for debugging | Low | Low | Documented as an open question (Section 12) rather than silently dropped; a future ticket can add manual spans to `getById`/`cancel` for readability without this being blocking for KAN-11's literal AC. |
| `NodeSDK.start()`'s non-blocking behavior could change across `@opentelemetry/sdk-node` versions | Low | Low | Behavior verified against the pinned version in `package.json` (`^0.221.0`); re-verify against release notes before any future upgrade of that package. |
| Ticket is later reopened because "distributed tracing" reads as a from-scratch build in the original ticket text | Low | Low | This plan documents the conflict explicitly (Section 4) so the ticket's status reflects reality instead of silently diverging from it. |

## 10. Test strategy

No new automated tests required for this plan's minimal scope — see Section 6 for why an automated span-assertion test is deferred rather than included. The manual verification run in Section 7 (Task 1) produces the evidence KAN-11's own ticket asks for.

## 11. Rollout & rollback

No production change. The manual verification run (Task 1) requires only setting `OTEL_ENABLED=true` locally against a throwaway collector; nothing is deployed or rolled back.

## 12. Open questions

- Should `getById` and `cancel` in `appointments.service.ts` get manual `withSchedulingSpan` wrappers for trace readability, even though auto-instrumentation already covers them functionally? This is a polish/observability-quality improvement, not an AC gap (Section 4, Section 6) — flagged for product/eng triage rather than decided unilaterally here.
- Should a future ticket add an `InMemorySpanExporter`-based integration test to give tracing behavior regression protection beyond a one-time manual verification? Deferred per Section 6; not blocking KAN-11 as written.
- KAN-11 lists "Structured logging ticket (for the shared trace ID)" as a dependency — per this plan's Section 4 and KAN-9's own grounding pass, the trace ID actually flows from `@opentelemetry/api`'s `trace`/`context` independent of the Pino setup; both tickets are independently done, so the dependency direction doesn't block either from being closed. Flagging for whoever triages ticket relationships.
