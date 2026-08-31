# KAN-5 — ORM Strategy Decision (TypeORM vs Prisma vs Drizzle)

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-5
- **Type / Status / Priority:** Story / To Do / High
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Before any entity/repository/migration code is written, the service needs one settled ORM decision, recorded as an ADR with a comparison table and explicit rationale — not just a name. The ticket's own description already states `## Decision: TypeORM` with a full TypeORM vs Prisma vs Drizzle comparison table, written that way per an earlier explicit instruction to settle on TypeORM. This plan checks whether that decision is (a) actually what the code does and (b) actually recorded as a formal ADR, as the ticket's own acceptance criteria require.

## 2. Scope

### In scope

- Verify the ticket's stated decision (TypeORM) matches what the real code does (dependency, `synchronize` setting, migration mechanism, exclusion-constraint handling).
- Confirm whether a formal ADR document exists for this decision.
- If missing, write the ADR — content only, no code change.

### Explicitly out of scope

- Re-opening or re-litigating the TypeORM vs Prisma vs Drizzle choice — the decision is a prior explicit instruction, already reflected in real, committed code (raw-SQL migration with `EXCLUDE USING gist`), not a new analysis this plan is meant to redo.
- Entity/repository/migration implementation (the ticket's own "Out of scope" section, and in this repo already done — see KAN-8's plan).
- Query performance tuning.

## 3. Assumptions

- The decision itself (TypeORM) is settled and out of scope for re-evaluation in this plan; the only open question is whether it is *recorded* the way the ticket's acceptance criteria require (as a merged ADR, not just ticket prose).
- "ADR" means a file in `docs/adr/` following this repo's existing ADR format (`docs/adr/0001-modular-monolith.md`, `0002-database-locking-over-message-queue.md`, `0003-tstzrange-exclusion-constraints.md`), since that is the only ADR convention this repo has.

## 4. Current behaviour

The decision is real and already implemented, but not yet recorded as a standalone ADR:

- **TypeORM is the actual dependency, not just a stated preference.** `package.json:60` lists `"typeorm": "^0.3.31"` (and `"@nestjs/typeorm": "^11.0.3"` at `package.json:42`); no `prisma`, `@prisma/client`, or `drizzle-orm` dependency exists anywhere in `package.json`.
- **`synchronize` is disabled everywhere, matching the ticket's AC #2.** `src/shared/config/database-options.ts:12` sets `synchronize: false, migrationsRun: false` for the running app; `src/shared/database/data-source.ts:19-20` sets the same for the TypeORM CLI data source used by `migration:run`/`migration:revert`.
- **Explicit, reviewable raw-SQL migrations exist, matching the ticket's AC #1 comparison rationale.** `src/shared/database/migrations/1724803200000-initial-schema.ts` is a real migration (`up()`/`down()`), not ORM-generated schema.
- **`EXCLUDE USING gist` is expressed via raw SQL migration, matching the ticket's AC #3.** `1724803200000-initial-schema.ts:249-260` defines `appointments_technician_no_overlap` and `appointments_service_bay_no_overlap` as `CONSTRAINT ... EXCLUDE USING gist (...)  WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'))` inside the same migration that creates the `appointments` table — TypeORM decorators are not used to generate this constraint, consistent with the ticket's own comparison table row ("TypeORM: Full raw-SQL migration escape hatch; constraint SQL is explicit and reviewable").
- **The rationale already exists in prose, just not as a formal ADR.** `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` section "6. Proposed Data Model", at line 363, states: *"While TypeORM supports `@Exclusion`, **explicit raw SQL migrations** are used to maintain full deterministic control over constraint names, partial filter predicates, extensions, and generated columns. `synchronize` is disabled in all environments except simple test mocks."* This is the same reasoning as the ticket's comparison table, already written down — just not in `docs/adr/`.

**Gap found:** `docs/adr/` contains exactly three files — `0001-modular-monolith.md`, `0002-database-locking-over-message-queue.md`, `0003-tstzrange-exclusion-constraints.md` (confirmed by directory glob). There is no `0004-*.md` or any other ORM-specific ADR. The ticket's acceptance criteria explicitly require the decision be "recorded as an ADR containing the comparison table above and the explicit rationale — not just 'we chose TypeORM'"; today that record exists only as Jira ticket prose and as unstructured rationale inside a large planning document, not as a merged ADR.

## 5. Proposed approach

**Done at the decision and code level; one small documentation gap.** The decision is real, matches the code, and is not being revisited. The only work is writing `docs/adr/0004-typeorm-over-prisma-drizzle.md`, following the exact structure of the existing three ADRs (`Status`/`Date` header, `## Context`, `## Decision`, `## Consequences` with `### Positive`/`### Negative`, `## Alternatives considered`, `## Evolution triggers`), distilling:

- the ticket's own comparison table (TypeORM vs Prisma vs Drizzle across the four criteria already listed in the ticket), reframed as `## Alternatives considered`;
- the ticket's `## Decision: TypeORM` paragraph, reframed as `## Context` + `## Decision`;
- the existing rationale at `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md:363` (raw-SQL escape hatch, `synchronize` disabled) as supporting evidence, cited directly rather than re-derived;
- a `## Consequences` section naming the trade-off already implicit in the ticket ("more verbose repository API, some decorator 'magic'" as the negative, full raw-SQL control as the positive) — matching the tone of `0002` and `0003`'s Positive/Negative lists;
- `## Evolution triggers` noting this should be revisited only if a future requirement can't be expressed as TypeORM raw SQL migrations (unlikely, since the hardest case — `EXCLUDE USING gist` — is already solved this way).

No code change. No re-analysis of the ORM choice itself.

## 6. Alternatives considered and rejected

- **Leave the decision only in the Jira ticket description.** Rejected — the ticket's own first acceptance criterion explicitly requires "it is recorded as an ADR," not ticket prose; Jira tickets are not the durable architecture record this repo uses (`docs/adr/` is).
- **Re-open the TypeORM vs Prisma vs Drizzle comparison.** Rejected — the decision was made deliberately per an earlier explicit instruction, and the resulting code (raw-SQL exclusion-constraint migration, `synchronize: false` in both the app and CLI data source) already reflects it working correctly. There is no new evidence in this repo suggesting the choice should change; per this project's decision rules, a verified decision should not be reversed absent new evidence.
- **Fold the ORM rationale into an existing ADR (e.g. append to `0003-tstzrange-exclusion-constraints.md`).** Rejected — `0003` is scoped to the range/exclusion-constraint decision specifically; the ORM choice is a separate, broader decision (it also covers migration tooling and NestJS integration, not just the exclusion-constraint mechanism) and deserves its own numbered ADR, consistent with how `0001`/`0002`/`0003` are each scoped to one decision.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Write `docs/adr/0004-typeorm-over-prisma-drizzle.md` using the `0001`–`0003` format, the ticket's comparison table, and the `SCENARIO_A_IMPLEMENTATION_PLAN.md:363` rationale | `docs/adr/0004-typeorm-over-prisma-drizzle.md` (new) | none | 0.25d |
| 2 | Cross-check the new ADR's claims (`synchronize: false`, raw-SQL migration path, `EXCLUDE USING gist`) against the current state of `database-options.ts`, `data-source.ts`, and the initial-schema migration so the ADR doesn't drift from code at write time | n/a (review only) | Task 1 | included above |

Total: ~0.25 day. One new file, no code touched.

## 8. Data & migration impact

None. Documentation-only change.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| ADR becomes stale if a future migration changes the `synchronize`/raw-SQL approach | Low | Low | ADR cites exact file paths (`database-options.ts`, `data-source.ts`, the initial-schema migration) so a future reader can verify it still holds, rather than asserting an unfalsifiable claim. |
| ADR is written but never linked from anywhere a future contributor would look | Low | Low | Reference the new ADR number (`0004`) from this plan and expect the `docs/adr/` directory listing itself to be the discovery path, consistent with how `0001`–`0003` are discovered today (no index file exists in this repo, so no new pattern is being introduced). |

## 10. Test strategy

Not applicable — no runtime behavior changes. Verification is a manual review: confirm `docs/adr/0004-typeorm-over-prisma-drizzle.md` exists, follows the established ADR structure, and every factual claim in it (dependency version, `synchronize` value, migration file path, constraint names) matches the corresponding source file at the time of writing.

## 11. Rollout & rollback

Add one new markdown file under `docs/adr/`. No deployment, feature flag, or runtime impact. Rollback is a plain revert of the commit that adds the file.

## 12. Open questions

- None outstanding — the ticket's own decision, the code, and the missing-ADR gap are all unambiguous from source. No product or architectural judgment call is needed beyond writing the document.
