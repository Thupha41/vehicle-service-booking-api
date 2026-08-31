# KAN-7 — Database Provisioning, Connection Pooling & SSL Configuration

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-7
- **Type / Status / Priority:** Story / To Do / High
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

The database connection needs explicit, deliberate configuration — bounded pool size, enforced TLS with CA verification, connection/query timeouts, and a least-privilege application database role — before the service runs anywhere beyond a local machine. The ticket was written fresh-start ("no connection configuration exists yet"), but this repo already has a dedicated connection-options module. This plan checks that module against the ticket's three acceptance criteria and is honest about the one criterion that cannot be verified — or satisfied — from inside the application repo.

## 2. Scope

### In scope

- Verify pool sizing, SSL enforcement, and connection/query timeout configuration against the ticket's AC #1 and AC #2.
- Assess AC #3 (least-privilege database role) honestly: determine whether it is satisfied, unsatisfied, or simply unverifiable from application code, and say which.
- Check whether the ticket's "Evidence to attach" line (a test or load run demonstrating bounded pool behavior under concurrent load) already exists in some form.

### Explicitly out of scope

- Read replicas and a connection proxy (the ticket's own "Out of scope" section).
- Actually provisioning a least-privilege database role in any real environment — that is an infrastructure/operations action for whoever runs the target database (RDS, Cloud SQL, a self-managed instance, etc.), not application code.

## 3. Assumptions

- "Documented pool size × max instance count stays under the database's connection limit" (AC #2) requires knowing the target deployment's max horizontal instance count and the target database's connection limit — neither is fixed by this repo, since no specific hosting platform has been chosen yet. This plan treats the *code* side (a bounded, non-default pool size) as verifiable now, and the *multiplication-stays-under-limit* documentation as an operational task that depends on a deployment target not yet selected.
- Local development's `docker/postgres/init/001-create-test-database.sql` and `compose.yaml` intentionally use one `scheduler` superuser-equivalent role for developer convenience; this is a reasonable local-dev shortcut and is not evidence that production would do the same, but it also is not evidence that a least-privilege role has been *designed* anywhere in this repo.

## 4. Current behaviour

Verified by reading the current files directly (not solely from prior grounding notes):

- **SSL enforcement.** `src/shared/config/database-options.ts:28`: `ssl: databaseSsl ? { rejectUnauthorized: true } : undefined`. When `DATABASE_SSL` is true, TLS is enforced with certificate verification on (`rejectUnauthorized: true`, the default/strict mode); when false, SSL is off entirely, matching "never silently skipped" only insofar as the environment variable is set correctly per environment.
- **`DATABASE_SSL` is strictly typed, not a loose truthy check.** `src/shared/config/environment.ts:37-51` (`parseBoolean`) only accepts the literal boolean `true`/`false` or the strings `'true'`/`'false'`; anything else throws `DATABASE_SSL must be either true or false` at startup — a misconfigured environment fails fast instead of silently defaulting to insecure.
- **`DATABASE_URL` is validated as a real PostgreSQL URL.** `environment.ts:65-82` (`validateDatabaseUrl`) throws unless the value parses as a URL with protocol `postgres:` or `postgresql:`.
- **Bounded connection pool.** `database-options.ts:23-27`: `extra: { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }` — an explicit, non-default cap of 10 connections per instance, not left at the `pg` driver's default.
- **Connect/retry timeouts, not driver defaults.** `database-options.ts:20-22`: `connectTimeoutMS: 5_000, retryAttempts: 3, retryDelay: 1_000`.
- **The same bounded/SSL-aware configuration is duplicated (deliberately) in the TypeORM CLI data source.** `src/shared/database/data-source.ts:19,22`: `synchronize: false, migrationsRun: false` and `ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined` — the migration runner uses the same SSL policy as the running app.
- **Local dev and CI both use one shared role for everything, not a least-privilege split.** `compose.yaml:5-7` sets `POSTGRES_USER: scheduler` / `POSTGRES_PASSWORD: scheduler` for the `db` service, and the `api` and `migrate` services both connect via `DATABASE_URL: postgresql://scheduler:scheduler@db:5432/scheduler` (`compose.yaml:25,49`) — the same role runs migrations (schema DDL) and serves the running application (DML only, ideally). `docker/postgres/init/001-create-test-database.sql:1`: `CREATE DATABASE scheduler_test OWNER scheduler` — the `scheduler` role is the database *owner* in this local setup, the opposite of AC #3's "not the database owner." `.github/workflows/ci.yml:16-17,27-28` uses the same `scheduler`/`scheduler` credentials for CI. None of this proves what a real staging/production deployment would do, but it also does not demonstrate the least-privilege pattern anywhere in this repo, even as a documented target shape.
- **No purpose-built pool-load test exists, but concurrent-load coverage exists as a side effect.** `test/concurrency/booking.concurrency.spec.ts` fires batches of concurrent booking requests (`concurrentBookings()`, using `Promise.all`, e.g. lines 111-227) through a fully bootstrapped app instance using the real pooled `DataSource` (pool `max: 10`). Its purpose is verifying the exclusion-constraint invariant under race conditions (KAN's booking-atomicity requirement), not asserting pool metrics or pool-exhaustion behavior directly — but it does exercise the bounded pool under concurrent load in CI without failures, which is indirect, not purpose-built, evidence for the ticket's "Evidence to attach" line.

## 5. Proposed approach

**Done-with-one-gap, and the gap is honestly outside this repo's reach.** Everything AC #1 and AC #2 ask for at the code level is implemented: TLS is enforced with certificate verification when `DATABASE_SSL=true`, the boolean is strictly validated, the pool is explicitly bounded (not left at driver defaults), and connect/retry timeouts are explicit. No code change is needed for those two criteria.

AC #3 ("the application database role is not the database owner, least-privilege") is a database/infrastructure provisioning action — who runs `CREATE ROLE app_user ...` and `GRANT` statements against the target database — not something the application's TypeORM configuration can enforce or demonstrate from inside `src/`. This repo's own local/CI setup does not currently model least-privilege (it uses one owner role everywhere, for simplicity), so this plan does **not** claim AC #3 is satisfied. The honest characterization is: *code-level pooling/SSL/timeout configuration is fully done; DB-role least-privilege is an infra-provisioning task belonging to whoever provisions the target database, not a code gap in this repo.*

Recommended action (documentation only, no code change): add a short paragraph to a deployment/runbook doc (or, if none exists yet, a note in this plan serves as the record) stating that non-local environments must provision a dedicated, non-owner application role with only the DML/DDL-as-needed privileges the app and its migration runner require, distinct from the local `scheduler` convenience role. This is explicitly a recommendation for ops/deployment work, not a claim that it is already done.

## 6. Alternatives considered and rejected

- **Add a `CREATE ROLE`/`GRANT` script to the migrations.** Rejected — migrations run *as* the connected role; that role cannot retroactively strip its own owner privileges mid-migration in a way that's meaningful for how the role is provisioned in a managed database service (RDS/Cloud SQL typically provision roles outside the app's migration path). Role provisioning is inherently tied to the specific hosting platform chosen, which this repo does not yet fix.
- **Mark AC #3 as satisfied because the pool/SSL config is otherwise complete.** Rejected — this would misrepresent an unverified claim as done, which this plan's brief explicitly warns against. The honest status is a named gap outside this repo's code, not a false "done."
- **Write a synthetic load test asserting pool exhaustion behavior (e.g. drive 15 concurrent long-running queries against `max: 10` and assert the 11th waits/times out).** Considered as the more literal reading of the ticket's "Evidence to attach" line. Not added in this plan because it would be new test infrastructure beyond what a verify-only pass should introduce; flagged in Section 12 as an optional follow-up rather than done silently.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Verify current SSL/pool/timeout config against source (this plan) | `src/shared/config/database-options.ts`, `src/shared/config/environment.ts`, `src/shared/database/data-source.ts` | none | done as part of this plan |
| 2 | Add a short deployment-role note (least-privilege application role, distinct from local `scheduler` owner role) to a runbook/deployment doc, or leave as an explicit open item if no such doc exists yet | TBD deployment doc (none currently found under `docs/`) | none | 0.25d, optional |

Total: effectively 0 days of code work; at most 0.25 day of documentation if Task 2 is picked up.

## 8. Data & migration impact

None. No schema, entity, or connection-option code is changed by this plan.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A future reader mistakes "pooling/SSL code is done" for "AC #3 is done" | Medium | Medium | This plan states the distinction explicitly in Section 5; keep that framing in any status update derived from this plan. |
| `DATABASE_SSL=false` is used by mistake in a non-local environment | Low | High | Already mitigated in code: `parseBoolean` requires an explicit value and the default is `false`, so a deployer must consciously set `DATABASE_SSL=true` for TLS — not a silent default-on that could mask misconfiguration, but also not a fail-closed default that forces the decision. Flagged, not changed, since altering the default is a product/ops decision outside this ticket's evidence line. |
| No purpose-built pool-exhaustion test exists, only incidental concurrent-load coverage | Low | Low | `test/concurrency/booking.concurrency.spec.ts` already exercises the pool under concurrent load without failures; a dedicated pool-exhaustion test is a reasonable follow-up (Section 12) but not required to call AC #1/#2 done at the code level. |

## 10. Test strategy

No new tests required to consider AC #1/#2 satisfied — the configuration is declarative and already exercised indirectly by every test suite that boots the app against a real PostgreSQL instance (`test/concurrency/booking.concurrency.spec.ts`, integration/e2e suites). If a purpose-built pool-bounding test is later requested, it belongs in `test/integration/` or `test/concurrency/`, asserting that concurrent requests beyond the pool `max` queue rather than error, using the same `createApiTestApp()` helper the concurrency suite already uses.

## 11. Rollout & rollback

No code change proposed. If the optional documentation task (Section 7, Task 2) is picked up, it is an additive doc change with no runtime impact and no rollback risk beyond reverting the doc edit.

## 12. Open questions

- Should this repo add a purpose-built connection-pool load test (concurrent requests beyond `max: 10`, asserting queuing rather than failure) to more literally satisfy the ticket's "Evidence to attach: a test or load run demonstrating pool behavior stays bounded under concurrent load"? Not added in this plan (Section 6); flagged for whoever owns test-coverage expansion.
- What is the actual target deployment platform (self-managed PostgreSQL, RDS, Cloud SQL, etc.)? AC #2's "pool size × max instance count under connection limit" and AC #3's "least-privilege role provisioning" both depend on that choice, which is not yet fixed anywhere in this repo's docs. This is a product/infrastructure decision, not something this plan can resolve from source alone.
