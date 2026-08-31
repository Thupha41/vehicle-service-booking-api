# KAN-10 — Observability: Metrics Collection & Alerting Strategy

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-10
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

The service needs machine-readable metrics for HTTP behavior and business-critical outcomes, plus a documented alerting baseline an operator can wire into an alert rule. The ticket was written as a fresh-start backlog item ("no metrics exist yet"), but this codebase already has running code in this area (`src/shared/observability/metrics.service.ts`, `metrics.controller.ts`, `http-metrics.interceptor.ts`) and an existing Vietnamese-language observability section in `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` that documents concrete alert thresholds. This plan grounds the ticket against that real code and documentation before proposing changes.

## 2. Scope

### In scope

- Verify KAN-10's four acceptance criteria against the current implementation and documentation.
- Confirm the `/metrics` endpoint actually serves the Prometheus registry (not just that `MetricsService` exists in isolation), and that the HTTP interceptor calls it with normalized, low-cardinality labels.
- Cite the existing alerting-threshold documentation as evidence rather than proposing a new alerting doc from scratch.

### Explicitly out of scope

- Standing up the metrics backend/dashboard (e.g. Grafana) — KAN-10 marks this out of scope explicitly.
- Wiring the documented alert thresholds into an actual alerting system (e.g. Prometheus Alertmanager rules, CloudWatch alarms) — KAN-10's AC only requires the baseline to be *documented* with concrete thresholds, not deployed; deploying alert rules is deployment-platform work outside this repo.
- Any change to the label schema or metric names already in production use (`uss_http_requests_total`, `uss_booking_*`, etc.) — renaming these would be a breaking change to any dashboard already built against them, and nothing in the ticket asks for a rename.

## 3. Assumptions

- "A documented alerting baseline with concrete thresholds" is satisfied by a written document with numeric thresholds an operator can transcribe into an alert rule, not by actual alert rule YAML/Terraform living in this repo — KAN-10's own scope note ("Standing up the metrics backend/dashboard... is out of scope") supports treating a prose threshold document as sufficient.
- "None use raw resource IDs" is verified by reading every label attached to every metric in `metrics.service.ts` and `http-metrics.interceptor.ts` and confirming each is either an HTTP method, a route *template* (not an interpolated path), a status code, or a closed enum-like reason string — not by a broader repo-wide audit of all possible future metrics.
- The existing `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` observability section, written in Vietnamese section headers with English metric names, counts as "documented" for KAN-10's purposes even though it predates this ticket and lives outside `docs/migration/` — it is real, current, and accurate against the code (verified below), which is what the AC actually requires.

## 4. Current behaviour

All four acceptance criteria are already implemented and documented:

- **`/metrics` endpoint, Prometheus format, wired in:** `MetricsController` (`src/shared/observability/metrics.controller.ts:8-18`) is registered on `ObservabilityModule` (`src/shared/observability/observability.module.ts:6-12`, `@Global()`), which is imported into `AppModule` (`src/app.module.ts:45`). `GET /metrics` calls `this.metrics.render()` (`metrics.controller.ts:16`), which returns `this.registry.metrics()` (`metrics.service.ts:170-172`) — the actual `prom-client` `Registry` instance every counter/histogram/gauge in the file registers against (`registers: [this.registry]` on each metric definition). The controller is `@ApiExcludeController()`-tagged so it doesn't pollute the public Swagger surface, but it is a live, mounted route.
- **HTTP totals, latency histograms, process metrics:** `httpRequests` (Counter, `uss_http_requests_total`, `metrics.service.ts:32-37`), `httpDuration` (Histogram, `uss_http_request_duration_seconds`, `:39-45`, buckets `0.01`-`5`s), `activeRequests` (Gauge, `uss_http_active_requests`, `:47-51`), plus `collectDefaultMetrics({ register: this.registry, prefix: 'uss_' })` (`:99`) for Node process metrics (event-loop lag, heap, GC, etc. — `prom-client`'s standard set). These are populated by `HttpMetricsInterceptor` (`http-metrics.interceptor.ts:15-58`), registered globally as `APP_INTERCEPTOR` in `app.module.ts:54`, so every HTTP request through the app is measured, not just specific routes.
- **Business-critical write-operation counters:** `bookingAttempts` (`uss_booking_attempt_total`, `:53-57`), `bookingConfirmed` (`uss_booking_confirmed_total`, `:59-63`), `bookingConflicts` (`uss_booking_conflict_total{reason}`, `:65-70`), `bookingResourceUnavailable` (`uss_booking_resource_unavailable_total{reason}`, `:72-77`), plus duration histograms with an `outcome` label (`bookingTransactionDuration`, `availabilityCheckDuration`, `:79-93`). These are called directly from the domain logic in `src/modules/appointments/application/appointments.service.ts`: `recordBookingAttempt()` (`:85`), `recordBookingConflict('idempotency_key_reused')` (`:211`), `recordUnavailable(...)` → `recordBookingResourceUnavailable(reason)` (used at `:238, 253` and further down the same method for the bay-unavailable case), and `startBookingTransactionTimer()`/`startAvailabilityCheckTimer()` stopped with a closed outcome value (`'confirmed' | 'idempotent_replay' | 'conflict' | 'resource_unavailable' | 'error'` for bookings, `'available' | 'unavailable' | 'error'` for availability checks) — so success/conflict/failure rates are queryable exactly as the AC asks.
- **Labels stay low-cardinality, never raw resource IDs:** every label used across both files is one of: an HTTP method string, a status code, a closed `reason`/`outcome` enum (`BookingConflictReason`, `BookingResourceUnavailableReason`, `BookingTransactionOutcome`, `AvailabilityCheckOutcome` — all string-literal unions, `metrics.service.ts:5-19`), or a **route template**, not an interpolated path. `HttpMetricsInterceptor.routeLabel()` (`http-metrics.interceptor.ts:50-57`) reads `request.route.path` — Express's matched route *pattern* (e.g. `/v1/appointments/:id`), populated after routing but before any parameter substitution — and falls back to the literal string `'unmatched'` if no route matched, never the raw `request.url` or `request.path` (which would contain interpolated IDs). This is the specific mechanism that satisfies "never raw resource IDs," and it was verified by reading the interceptor's implementation, not assumed from the metric name alone.
- **Documented alerting baseline with concrete thresholds:** `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` section "12. Observability Strategy" already exists and states, under "Baseline Service Level Objectives (SLOs)" (lines 719-725) and "Sample Alerting Thresholds" (lines 727-733): HTTP 5xx rate > 2% over a 5-minute window; p95 booking latency > 500 ms over a 10-minute window; database connection pool utilization > 80%; RDS connections > 80% of instance maximum; a spike in unexpected DB lock-wait timeouts; unhealthy ECS task count > 0. The same section (lines 664-697) also documents the specific HTTP/business/database/infrastructure metric names an operator would query to evaluate those thresholds, matching this repo's actual metric names (`booking_attempt_total` etc., though prefixed `uss_` in the real code — see Section 12 open question).

**No gap found in code or documentation.** Both the metrics implementation and the alerting-threshold documentation already exist, match each other in intent, and satisfy all four acceptance criteria.

## 5. Proposed approach

**DONE.** No code change and no new documentation is needed. `metrics.service.ts`, `metrics.controller.ts`, and `http-metrics.interceptor.ts` already implement the full acceptance-criteria set, and `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` §12 already documents a concrete alerting baseline. The only action this plan recommends is a documentation cross-link (not a rewrite): add a short pointer from wherever this ticket is tracked (or a `docs/migration/` index, if one exists) to `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md#12-observability-strategy` so the existing alerting baseline is discoverable by anyone auditing KAN-10 without having to search the whole docs tree. This is optional housekeeping, not a functional gap — see Section 7.

## 6. Alternatives considered and rejected

**Write a new, dedicated alerting-thresholds document under `docs/migration/`** — rejected: KAN-10's AC only asks that thresholds be documented somewhere concrete and actionable, and `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` §12 already does this accurately against the real metric set. Duplicating it into a second document would create two sources of truth that can drift out of sync; a cross-link is the lower-risk choice.

**Add a metrics-endpoint smoke test asserting `/metrics` returns 200 and contains `uss_http_requests_total`** — considered as an optional evidence-strengthening addition (no test currently exercises `/metrics` or `/health/*`, confirmed via grep of `test/**`, zero matches for either path). Not included in the work breakdown because KAN-10's own Evidence line only asks for a "sample metrics endpoint output," which can be captured manually (`curl http://localhost:3000/metrics`) without new test infrastructure. Flagged in Section 12 as a candidate for a future, separate observability-testing ticket rather than folded into this already-done ticket's scope.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add a short cross-reference from the KAN-10 ticket (or a docs index, if present) to `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md#12-observability-strategy` | none (Jira ticket comment or doc index only) | none | 0.1d |

Total: negligible. No code or test files touched.

## 8. Data & migration impact

None. No schema, entity, or migration touched.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Metric names in `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` (e.g. `booking_attempt_total`) omit the `uss_` prefix the real code uses (`uss_booking_attempt_total`), which could mislead an operator copying a query verbatim | Low | Low | Note the prefix mismatch explicitly here (Section 12); not fixed as part of this plan since it's a one-line doc accuracy nit, not a functional gap, and touching that doc is outside this ticket's minimal scope. |
| Ticket is later reopened because "metrics collection" reads as a from-scratch build in the original ticket text | Low | Low | This plan documents the conflict explicitly (Section 4) so the ticket's status reflects reality instead of silently diverging from it. |

## 10. Test strategy

No new tests required — this is a verification-only pass over already-implemented, already-functioning code and documentation. If a future ticket wants automated evidence for the `/metrics` endpoint's shape, see the deferred candidate in Section 6.

## 11. Rollout & rollback

No production change. If the optional doc cross-link (Section 7, Task 1) is added, it's a one-line documentation edit with no rollback risk beyond reverting the edit.

## 12. Open questions

- `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md`'s metric names (`booking_attempt_total`, `booking_no_technician_total`, `booking_no_bay_total`, `idempotent_replay_total`) don't exactly match the real code's names (`uss_booking_attempt_total`, and `no_technician`/`no_bay`/`idempotent_replay` show up as `reason`/`outcome` label *values* on `uss_booking_resource_unavailable_total{reason}` and `uss_booking_transaction_duration_seconds{outcome}` respectively, not as separate counter names). This is a pre-existing doc-vs-code naming drift, not something this ticket's acceptance criteria require fixing (the AC asks for *a* documented baseline with concrete thresholds, which exists) — flagging for whoever next touches that doc so the drift doesn't compound.
- Whether a `/metrics`-endpoint smoke test belongs to KAN-10 or to a separate test-coverage ticket is a scope call the plan doesn't make unilaterally (Section 6) — flagged for triage rather than silently added to or excluded from this ticket's Definition of Done.
