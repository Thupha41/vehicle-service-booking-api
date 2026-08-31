# KAN-8 — Database Migration & Seeding Strategy

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-8
- **Type / Status / Priority:** Story / To Do / High
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Schema changes need one controlled, repeatable path — executed once per deployment as a pipeline step, never racing across scaled app instances, with a clear rollback/forward-fix policy — and local/demo environments need a seed that is idempotent and repeatable. The ticket was written fresh-start, but this repo already has a migration file, a seed script, a CLI data source, and a CI pipeline wiring them together. This plan verifies each acceptance criterion against the real files, with particular care on the one thing not previously verified: whether the seed script is actually safe to run twice.

## 2. Scope

### In scope

- Verify migrations run as a single controlled step (not from app boot) and are reviewable, explicit SQL.
- Verify the seed script's idempotency by reading its full implementation, not assuming it from convention.
- Verify a fresh-database migrate-then-seed path reaches a known-good state with no manual SQL.
- Assess whether a documented rollback/forward-fix policy exists for a failed migration.

### Explicitly out of scope

- Backfilling pre-existing production data (the ticket's own "Out of scope" — none exists yet).

## 3. Assumptions

- "Migrations execute exactly once as a pipeline step, never concurrently from multiple scaled instances" is satisfied by migrations being invoked as an explicit, separate CI/deploy step (not from `main.ts`/app bootstrap) — this repo does not run migrations from application boot anywhere, so the concurrency risk the AC warns about does not arise from this codebase's own design.
- "Known-good demo state with no manual SQL" means `pnpm migration:run` followed by `pnpm seed` against an empty database, with no operator-run `psql` commands — matching how CI itself does it.

## 4. Current behaviour

Verified by reading the full source of each file, not solely from prior grounding notes:

- **Exactly one migration exists today**, `src/shared/database/migrations/1724803200000-initial-schema.ts` (309 lines) — a plain TypeORM `MigrationInterface` with `up()`/`down()`, entirely raw SQL (`queryRunner.query(...)`). It creates `btree_gist`, all Scenario-A tables (`dealerships`, `customers`, `vehicles`, `service_types`, `skills`, `technicians`, `technician_shifts`, `technician_unavailability`, `service_bays`, `service_bay_unavailability`, `appointments`), all foreign keys/check constraints, the two `EXCLUDE USING gist` constraints on `appointments` (lines 249-260), and six supporting indexes (lines 264-287). `down()` (lines 290-307) drops every table in FK-safe reverse order and explicitly leaves `btree_gist` installed, with an inline comment explaining why (extension lifecycle belongs to provisioning, not this schema's rollback).
- **Migrations run as an explicit, separate CLI step, not from app boot.** `src/shared/database/data-source.ts` is a dedicated TypeORM CLI `DataSource` (`synchronize: false, migrationsRun: false` at lines 19-20) used only by the `typeorm-ts-node-commonjs` CLI. `src/shared/config/database-options.ts` (the app's own runtime connection) also sets `migrationsRun: false` (line 13) — the running app never auto-applies migrations at startup. `package.json:28-29` wires `migration:run`/`migration:revert` to `typeorm-ts-node-commonjs migration:run -d src/shared/database/data-source.ts`.
- **CI runs migrate then seed as their own pipeline steps, before lint/typecheck/tests/build.** `.github/workflows/ci.yml:51-52`: `run: pnpm migration:run` immediately followed by `run: pnpm seed`, both after `pnpm install` and before `pnpm lint`/`pnpm typecheck`/any test suite/`pnpm build`. This is a single sequential job (`runs-on: ubuntu-latest`, one `postgres:17-alpine` service container) — there is no concurrent/scaled-instance execution of migrations anywhere in this pipeline, which is the exact race the AC is trying to prevent.
- **`compose.yaml` mirrors the same one-shot pattern for local/demo Docker use.** A dedicated `migrate` service (`compose.yaml:36-54`) runs `typeorm/cli.js migration:run` once, with `restart: 'no'`, and the `api` service has `depends_on: migrate: condition: service_completed_successfully` (lines 30-32) — the app container only starts after migrations finish, and migrations are not run by the `api` container itself.
- **Seed idempotency — verified by reading `src/shared/database/seed.ts` in full (266 lines).** Every single `INSERT` in the seed is one of:
  - `INSERT ... VALUES (...) ON CONFLICT (id) DO UPDATE SET ... updated_at = now()` — used for `dealerships` (lines 54-64), `customers` (80-91), `vehicles` (93-105), `service_types` (114-129), `technicians` (174-187), `service_bays` (235-249), and `technician_shifts` (211-227, keyed on the shift's fixed `id`); or
  - `INSERT ... ON CONFLICT (dealership_id, day_of_week) DO UPDATE SET ...` for `dealership_business_hours` (66-78, a natural composite key), or
  - `INSERT ... ON CONFLICT (...) DO NOTHING` for pure join/association tables with no mutable columns of their own — `service_type_required_skills` (158-167), `technician_skills` (196-205) — and `skills` itself uses `ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name` (140-146).

  There is no plain `INSERT` anywhere in the file without a conflict clause, and every ID is a fixed literal UUID from the `SEED_IDS` constant (lines 5-32) or a fixed literal array (`BUSINESS_HOUR_IDS`, lines 34-41) rather than a generated one — so a second run targets the exact same rows and either updates them in place or no-ops. The whole body runs inside one transaction (`seedDataSource.transaction(async (manager) => { ... })`, line 52), so a partial failure mid-seed rolls back rather than leaving a half-applied state. **Conclusion: running `seed.ts` twice is safe — no duplication, no unique-constraint error.** This confirms the ticket's "idempotent and repeatable" requirement and the "running it twice doesn't duplicate data or error" key consideration exactly as written.
- **Fresh-database migrate-then-seed reaches a known-good state with no manual SQL**, and CI proves it: `ci.yml`'s `postgres` service starts from an empty `scheduler_test` database (only `docker/postgres/init/001-create-test-database.sql`'s `CREATE DATABASE scheduler_test OWNER scheduler` runs first, which is provisioning, not schema/data), then `pnpm migration:run` creates the schema and `pnpm seed` populates it — both automated, no operator SQL.
- **No required database extension needs manual setup.** `btree_gist` is created by the migration itself (`1724803200000-initial-schema.ts:7`, `CREATE EXTENSION IF NOT EXISTS btree_gist`), not by any manual provisioning step, matching the ticket's "Any required database extensions are created by migration, not manual setup."

**Gap found (rollback/forward-fix policy, documentation only):** the ticket's AC #3 asks that "a migration fails partway, deployment halts before any app version referencing the new schema is released," and its "Evidence to attach" line explicitly asks for a "documented rollback / forward-fix policy." The mechanical pieces exist — `migration:revert` (`package.json:29`) reverts the most recent migration, CI runs `migration:run` as a step that fails the whole job (and therefore blocks `pnpm build` and deployment) if any query in `up()` throws — but there is no written policy document stating this explicitly (e.g. "on migration failure in CI, the job fails and nothing is deployed; to roll back a bad migration already applied to an environment, run `pnpm migration:revert` or ship a forward-fixing migration"). This is a real, small documentation gap, distinct from the seed-idempotency question which is fully resolved as done.

## 5. Proposed approach

**Done, with one small documentation gap.** Migrations, seeding, and their pipeline wiring are already fully implemented and correct: one raw-SQL migration creating the entire schema plus required extension, a genuinely idempotent seed script (verified line-by-line, not assumed), and CI/`compose.yaml` both running migrate-then-seed as explicit one-shot steps rather than from app boot. No code change is needed for AC #1, #2, or the extension/idempotency key considerations.

The one gap is documentation: write a short rollback/forward-fix policy paragraph (a few sentences, not a new document type) stating the two mechanisms this repo already has — `pnpm migration:revert` for rolling back the most recently applied migration, and "ship a new forward migration" as the alternative — and where CI failure already prevents a broken migration from reaching deployment (a failing `pnpm migration:run` step fails the whole CI job before `pnpm build` runs). This can live as a short section in `docs/` (e.g. appended to an existing operations/runbook doc if one exists, or as its own short `docs/database-migration-policy.md` if not) — sizing this as a single small task, not a new subsystem.

## 6. Alternatives considered and rejected

- **Add automatic rollback-on-failure logic to the CI step itself** (e.g. a script that calls `migration:revert` automatically if `migration:run` fails). Rejected — TypeORM's `up()` for this migration runs inside implicit per-statement execution, not one wrapping transaction by default for raw multi-statement migrations, so an automatic revert after partial failure could attempt to drop tables that were never created; a documented manual/scripted forward-fix judgment call (already possible via `migration:revert`) is safer than blind automation for a single-migration schema at this stage.
- **Rewrite the seed script to use a different idempotency mechanism** (e.g. `TRUNCATE` then re-insert). Rejected — the current `ON CONFLICT` approach is already correct, non-destructive (preserves any manually added demo rows with different IDs), and matches the ticket's "idempotent, repeatable" requirement with no observed defect; changing it would be unjustified churn against a verified-working implementation.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Write a short rollback/forward-fix policy note (CI-blocks-on-failure + `migration:revert` for applied migrations + forward-fix alternative) | `docs/database-migration-policy.md` (new) or an existing ops doc if the repo has one under `docs/` | none | 0.25d |

Total: ~0.25 day. No code changes; documentation only.

## 8. Data & migration impact

None from this plan itself — no new migration or seed change is proposed. (The existing migration and seed script are the subject of verification, not modification.)

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A future migration author adds a plain `INSERT` to `seed.ts` without a conflict clause, silently breaking idempotency | Low | Medium | Not fixed by this plan (no code change proposed); worth a one-line comment at the top of `seed.ts` reminding future editors that every insert must be `ON CONFLICT`-safe — flagged as an optional follow-up (Section 12), not added here to avoid scope creep on a verify-only pass. |
| Written rollback policy drifts from actual CI behavior if the pipeline changes later | Low | Low | Keep the policy note's claims tied to concrete, cited steps (`ci.yml`'s `migration:run` step, `package.json`'s `migration:revert` script) so it stays checkable against source. |

## 10. Test strategy

No new automated tests required — CI itself already is the evidence the ticket's "Evidence to attach" line asks for ("CI run showing migrate + seed succeeding against an empty database"): every CI run starts from a fresh `postgres:17-alpine` service container and runs `pnpm migration:run` then `pnpm seed` before any test suite. Seed idempotency was verified by full source reading in this plan (Section 4) rather than by adding a new "run seed twice" test; if stronger machine-checked evidence is wanted later, a one-line addition to CI (`run: pnpm seed` a second time, asserting exit code 0) would be a cheap follow-up — flagged in Section 12, not added here since the source-level verification already answers the question definitively.

## 11. Rollout & rollback

No code change. If the documentation task (Section 7) is picked up, it is a purely additive doc file with no runtime impact and no rollback risk beyond reverting the doc commit.

## 12. Open questions

- Should CI run `pnpm seed` a second time as an explicit machine-checked regression guard for idempotency, beyond the source-level verification in this plan? Not added here (Section 10); flagged as optional strengthening for whoever owns CI pipeline changes.
- Should `seed.ts` get a top-of-file comment enforcing the "every insert must be `ON CONFLICT`-safe" convention for future editors? Not added here to keep this plan verify-only; flagged as optional.
