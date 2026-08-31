# KAN-12 — Observability: Liveness & Readiness Health Checks

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-12
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

The deployment platform needs to tell "the process is alive" apart from "the process can serve traffic," so it doesn't restart a healthy process waiting on a slow dependency, or route traffic to one that can't reach its database. The ticket was written as a fresh-start backlog item ("no health checks exist yet"), but this codebase already has running code in this area (`src/modules/health/health.controller.ts`). This plan grounds the ticket against that real code before proposing changes.

## 2. Scope

### In scope

- Verify KAN-12's three acceptance criteria against the current implementation.
- Confirm `@nestjs/terminus` is genuinely in use and how `TypeOrmHealthIndicator` is provided (module wiring, not just an import in the controller).
- Confirm that a failing readiness check produces a non-2xx HTTP status without triggering any restart logic from within this repo, and note that "does not itself restart the instance" is deployment-platform behavior outside this codebase's control.

### Explicitly out of scope

- Startup probes for slow-boot dependencies beyond the database — KAN-12 marks this out of scope explicitly.
- Configuring the deployment platform's actual liveness/readiness probe wiring (e.g. ECS task definition health-check block, Kubernetes probe YAML) — that's infrastructure/deployment-platform configuration, not something this repo's code can determine or own; KAN-12's AC about "removes the instance from traffic without restarting it" is a platform behavior this repo can only make *possible* (by exposing distinct endpoints with correct semantics), not enforce.

## 3. Assumptions

- "Liveness checks process progress only" is satisfied by `live()` performing no I/O and no external dependency check at all — not merely a *fast* dependency check — matching the literal AC text ("no external dependency check").
- A bounded 1-second database ping (`TypeOrmHealthIndicator.pingCheck('database', { timeout: 1_000 })`) satisfies "times out within a bounded window rather than hanging" as written; KAN-12 does not specify a particular timeout value, so 1 second is treated as an implementation detail already within the spirit of "bounded," not a value requiring a product decision.
- "A failing readiness check removes the instance from traffic; it does not, by itself, trigger a restart" describes a property of the *contract* this endpoint exposes (a non-2xx HTTP status on `/health/ready` that a load balancer or orchestrator can key off of) rather than a behavior this repo's code can directly cause or prevent — the actual removal-from-traffic and non-restart decision is made by whatever deployment platform is configured to probe this endpoint, which is out of this repo's control by nature. This is treated as "correctly delegated to the deployment platform," not a gap, per the ticket's own framing (see Section 4).

## 4. Current behaviour

All three acceptance criteria are already implemented — this is a clean, exact match with no ambiguity:

- **Liveness checks process progress only, no external dependency:** `HealthController.live()` (`src/modules/health/health.controller.ts:18-24`) is decorated `@HealthCheck()` from `@nestjs/terminus` and its check function is `() => Promise.resolve({ api: { status: 'up' as const } })` — a synchronously-resolved literal, with no database call, no HTTP call, no filesystem access, and no dependency on `TypeOrmHealthIndicator` at all. If the Node process is running and able to execute this handler, liveness reports healthy regardless of database state.
- **Readiness performs a bounded database ping, fails fast:** `HealthController.ready()` (`:26-32`) calls `this.database.pingCheck('database', { timeout: 1_000 })` — `TypeOrmHealthIndicator` is `@nestjs/terminus`'s standard indicator, and its `{ timeout: 1_000 }` option (per Terminus's documented API) races the actual database ping against a 1-second timer, rejecting (and thus reporting `down`) if the ping hasn't resolved within that window rather than hanging indefinitely on an unreachable or saturated database.
- **`@nestjs/terminus` is genuinely in use, correctly wired:** `HealthModule` (`src/modules/health/health.module.ts:1-11`) imports `TerminusModule` (`:2, 7`) and declares `HealthController` (`:4, 8`); this is how `HealthCheckService` and `TypeOrmHealthIndicator` become injectable into the controller's constructor (`health.controller.ts:13-16`) without any manual provider wiring in `HealthModule` itself — `TerminusModule`'s own module definition supplies both. `HealthModule` is imported into `AppModule` (`src/app.module.ts:8, 46`), and `TypeOrmModule.forRootAsync(...)` is also configured in `AppModule` (`:36-43`), so `TypeOrmHealthIndicator` has a live `DataSource` to ping against. `package.json:41` pins `@nestjs/terminus` at `^11.1.1`.
- **Failing readiness removes traffic without triggering a restart — correctly delegated:** Terminus's `@HealthCheck()` decorator (used on both `live()` and `ready()`) is documented, standard Nest behavior: when any indicator in the check array reports `down`, the decorator throws a `ServiceUnavailableException` (HTTP 503) instead of returning 200; Nest's normal exception pipeline (through `GlobalExceptionFilter`, `src/shared/http/global-exception.filter.ts`) turns that into a JSON error response with a non-2xx status code. Nothing in `health.controller.ts` or `health.module.ts` calls `process.exit()`, sends a restart signal, or otherwise causes the process to terminate on a failed readiness check — the only observable effect from inside this repo is the HTTP status code on `/health/ready`. Whether a load balancer removes the instance from its target pool, and whether an orchestrator restarts the container, are both decisions made entirely by the deployment platform's own probe configuration (e.g. an ECS/Kubernetes liveness probe pointed at `/health/live` and readiness probe at `/health/ready`, each with its own failure-threshold/action policy) — this repo correctly exposes the two endpoints with the right semantics and leaves the platform-level response to the platform, matching the AC's own framing ("when the deployment platform observes it, then it removes the instance...").
- **Liveness log-spam avoidance (supporting detail, not an AC):** `logging.ts:79` explicitly ignores `/health/live` in `autoLogging`, so a frequently-polled liveness probe doesn't flood logs — a small piece of evidence that this endpoint was built with real production polling frequency in mind, not just written to satisfy a checklist.

**No gap found.** This ticket comes out fully DONE — every acceptance criterion is satisfied by code read directly, and the "does not itself trigger a restart" clause is correctly understood as platform-delegated behavior rather than something this repo could fail to implement.

## 5. Proposed approach

**DONE. No code change needed.** `health.controller.ts` and `health.module.ts` already implement both endpoints with exactly the semantics KAN-12 asks for, using the standard, correctly-wired `@nestjs/terminus` library. The only action worth taking is producing the manual evidence artifact KAN-12's own ticket already asks for ("Manual test: database stopped, readiness flips to false, liveness stays true").

## 6. Alternatives considered and rejected

**Add an automated e2e test that stops the test database mid-run and asserts `/health/ready` returns 503 while `/health/live` returns 200** — considered, but rejected for this plan's minimal scope: stopping/restarting a database connection mid-test-suite is disruptive to the existing e2e harness (which likely shares a single test database connection pool across specs — verify against `test/jest-e2e.json`/`test/e2e/appointments.e2e.spec.ts` setup before attempting this) and risks leaving the suite in a bad state for subsequent specs. KAN-12's own "Evidence to attach" line explicitly asks for a *manual* test ("database stopped, readiness flips to false, liveness stays true"), not an automated one — so this plan follows the ticket's own evidence expectation rather than inventing stricter automated coverage the ticket didn't ask for. If a future ticket wants this as a regression test, it should design a dedicated, isolated harness rather than reusing the shared e2e database.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Manual verification: with the app running against the local Docker Postgres (`pnpm db:up`), curl `/health/live` and `/health/ready` (both 200); stop the database (`pnpm db:down`); curl both again and confirm `/health/live` still returns 200 while `/health/ready` returns 503 within ~1 second; capture the output as the ticket's evidence artifact | none (evidence artifact only, attached to the Jira ticket) | none | 0.1d |

Total: negligible. No code or test files touched.

## 8. Data & migration impact

None. No schema, entity, or migration touched.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A deployment platform's probe configuration could point both liveness and readiness at the same endpoint by mistake during infra setup, defeating the distinction this code correctly provides | Low | Medium | Outside this repo's control (Section 2, explicitly out of scope) — noted here only so whoever configures the deployment platform's probes is aware two distinct endpoints (`/health/live`, `/health/ready`) exist and must be wired to the correct probe type. |
| Ticket is later reopened because "health checks" reads as a from-scratch build in the original ticket text | Low | Low | This plan documents the conflict explicitly (Section 4) so the ticket's status reflects reality instead of silently diverging from it. |

## 10. Test strategy

No new automated tests required — see Section 6 for why an automated database-stop test is deferred. The manual verification run in Section 7 (Task 1) produces the exact evidence artifact KAN-12's own ticket asks for.

## 11. Rollout & rollback

No production change. The manual verification run (Task 1) uses the existing local Docker Postgres lifecycle (`pnpm db:up` / `pnpm db:down`) already defined in `package.json:32-33`; nothing is deployed or rolled back.

## 12. Open questions

- None. This is the one ticket of the four where verification produced no gap, no open design question, and no deferred follow-up beyond the manual evidence capture itself.
