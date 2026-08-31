# KAN-4 — Resource Administration API (technicians, service bays, shifts, business hours)

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-4
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only reads confirmed the gap and found reusable groundwork; not yet debated)

## 1. Problem

There is no way to create or update a technician, shift, service bay, or business-hours record except by writing a migration or re-running the seed script. `README.md` and `docs/SYSTEM_DESIGN.md` both document this as an intentional scope cut for the current assessment, with `SYSTEM_DESIGN.md`'s "Current limitation: seed-only resource mutation" section explicitly listing six questions that must be answered before adding public mutation endpoints: admin auth/tenant scoping, audit trail, optimistic concurrency, blockout-conflict behavior, timezone validation, and import/idempotency for upstream systems. This plan answers those it can from existing groundwork and defers the rest to their owning tickets.

## 2. Scope

### In scope

- The write side (create/update) for technicians, technician skills, technician shifts, technician unavailability, service bays, and service-bay unavailability — the entities that already exist in `src/modules/resources/`.
- Optimistic concurrency and a minimal audit trail on those entities.
- Conflict handling when a shift/unavailability change would invalidate a `CONFIRMED`/`IN_PROGRESS` appointment.

### Explicitly out of scope

- Reference-data mutation (dealerships, service types, skills, customers, vehicles — the `src/modules/reference-data/` and `src/modules/vehicles/` entities). Same shape of problem, same missing auth dependency, but a separate ticket — bundling both modules into one ticket would make the work breakdown unreviewable and the two are independently shippable.
- Everything KAN-6 (Authentication & Authorization Strategy) owns: this ticket consumes that decision's contract, it does not make or implement the auth decision itself.
- Any change to the booking/availability flow (`appointments` module) — resource administration must not change how `POST /v1/appointments` or `POST /v1/availability/check` behave.
- Notifications/CRM sync on resource change, and a full admin UI (both already marked out of scope in the ticket text).

## 3. Assumptions

- KAN-6's decision (see `docs/migration/plans/KAN-6/KAN-6-implementation-plan.md`) is the authorization contract this ticket builds against: `Authorization: Bearer <JWT>` validated in-app, a `dealership_id` claim checked against the resource's `dealershipId`, `401 UNAUTHENTICATED` / `403 DEALERSHIP_SCOPE_VIOLATION` on failure, using the standard error envelope from `buildErrorBody` (KAN-16). This ticket cannot be implemented end-to-end (including its own tests requiring a real 401/403) until KAN-6's guard exists in code — KAN-6's plan itself only produces an ADR, not a guard implementation, so a small amount of "implement the `JwtAuthGuard`" work is really shared between the two tickets; this plan assumes whoever picks up KAN-4 also builds the guard if it doesn't yet exist, rather than blocking entirely on a separate ticket.
- "Audit trail" (per KAN-4's AC) is satisfied by an append-only log table recording actor, timestamp, entity type/id, and before/after values — not a full event-sourcing rebuild of the resources module. This matches `SYSTEM_DESIGN.md`'s own explicit rejection of event sourcing as out of scope for this project (ADR-level architectural stance, not something this ticket should quietly reverse).
- "Optimistic concurrency" is satisfied by a TypeORM `@VersionColumn()` on each mutable entity plus a `412 VERSION_CONFLICT` response when an update's submitted version doesn't match — TypeORM has first-party support for this (`@VersionColumn` + automatic `WHERE version = ?` on update), consistent with KAN-5's ORM decision.

## 4. Current behaviour

Confirmed by reading the code, not assumed:

- `src/modules/resources/` already has the full domain model this ticket needs to mutate: `TechnicianEntity` (`entities/technician.entity.ts` — `id`, `dealershipId`, `name`, `active`, `createdAt`, `updatedAt`; **no version column, no audit columns**), plus `TechnicianSkillEntity`, `TechnicianShiftEntity`, `TechnicianUnavailabilityEntity`, `ServiceBayEntity`, `ServiceBayUnavailabilityEntity` (not individually read in full, but present per `resources.module.ts:12-19`'s entity list).
- `resources.module.ts` wires `TypeOrmModule.forFeature(entities)` and exports one repository, `ResourceAllocationRepository` (`repositories/resource-allocation.repository.ts`) — read-oriented, used by the appointments module's availability/booking allocation logic. There is no application service, command, or controller for writes anywhere in this module.
- A controller grep across `src/modules/**` (confirmed earlier this session) finds only `appointments`, `health`, and the top-level `metrics` controller — no `ResourcesController` or equivalent exists.
- The pattern for domain errors already exists and should be reused, not reinvented: `src/modules/appointments/application/appointment-errors.ts` defines an `AppointmentError extends HttpException` class with a `(status, errorCode, message)` constructor and a small factory object (`appointmentError.notFound()`, `.slotConflict()`, etc.) — the same pattern (a `ResourceError` class + factory) is the natural fit here, and both flow through the same `GlobalExceptionFilter`/`buildErrorBody` envelope (KAN-16) with no special-casing needed.
- The booking invariant this ticket must not break: `appointments` table has two PostgreSQL exclusion constraints (`appointment_no_technician_overlap`, `appointment_no_service_bay_overlap`, per `docs/SCENARIO_A_IMPLEMENTATION_PLAN.md` section 6) that reject overlapping `CONFIRMED`/`IN_PROGRESS` appointments — these are unaffected by resource *data* changes (they constrain the `appointments` table, not `technicians`/`service_bays`), but a shift or unavailability change can still leave an already-confirmed appointment referencing a technician who's no longer available for that period, which the database won't catch by itself. That's the real conflict case Section 5 below addresses.

## 5. Proposed approach

Layer a standard application/presentation stack on top of the existing `resources` domain entities, following the same module shape `appointments` already uses (`domain/ → application/ → infrastructure/ → presentation/http/`):

1. **Entities:** add `@VersionColumn()` to each of the six mutable entities (optimistic concurrency), and a new `resource_audit_log` table/entity (append-only: `id, entity_type, entity_id, actor, action, before, after, occurred_at`) written to on every create/update inside the same transaction as the mutation — not a separate async step, so audit and mutation can't drift apart.
2. **Application layer:** one command per entity type × operation (e.g. `CreateTechnicianCommand`, `UpdateTechnicianShiftCommand`) under `src/modules/resources/application/commands/`, each: (a) enforcing the `dealership_id` claim from the authenticated request matches the target `dealershipId` (KAN-6's contract), (b) checking version on update, (c) for shift/unavailability changes specifically, querying for any `CONFIRMED`/`IN_PROGRESS` appointment that would fall outside the new availability window and rejecting the change with `409 RESOURCE_CHANGE_CONFLICT` unless the caller passes an explicit `force: true` override (recorded in the audit log when used) — this satisfies the "never silently invalidate a confirmed booking" acceptance criterion without blocking every legitimate shift change forever.
3. **Presentation layer:** a `ResourcesController` under `src/modules/resources/presentation/http/`, one route per command, each behind `@UseGuards(JwtAuthGuard)` (KAN-6), documented in Swagger the same way `appointments.controller.ts` already documents its routes.
4. **Timezone/schedule validation:** shift and business-hours payloads reuse the same IANA-timezone-aware validation the booking path already has (`src/modules/appointments/application/business-hours.ts` — read and reuse its logic/helpers rather than re-implementing timezone math from scratch).
5. **Import/idempotency for upstream systems:** out of this ticket's first cut — no upstream dealer-management system integration exists yet to design against (YAGNI); flagged as an open question (Section 12) rather than speculatively built.

## 6. Alternatives considered and rejected

**Build resource administration as a bulk "sync" endpoint (accept a full resource snapshot from an upstream system) instead of per-entity CRUD** — rejected for this first cut. `SYSTEM_DESIGN.md`'s own prerequisite list separates "import/idempotency contracts for upstream dealer-management systems" from the rest, implying it's a distinct, later concern once a real upstream system exists to integrate with. Per-entity CRUD is also what a human administrator actually needs first (per the ticket's own framing: "no way for staff to add a technician").

**Hard-reject any shift/unavailability change that conflicts with a confirmed appointment, with no override** — rejected. A real dealership sometimes needs to force a change (a technician quits, a bay floods) even when it invalidates existing bookings; a hard block would make the feature useless for its most realistic urgent use case. The `force: true` + audit-logged override (Section 5) keeps the safety default while not making the feature a dead end.

**Full event-sourcing/audit via a separate outbox + async projection** — rejected. `SYSTEM_DESIGN.md` explicitly lists event sourcing as a rejected pattern for this project ("No full CQRS read model," "not in MVP"). A synchronous, same-transaction audit-log insert is simpler and sufficient for "who changed what and when."

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | `JwtAuthGuard` (if not already built by KAN-6's own follow-through) + `dealership_id` claim extraction | `src/shared/auth/jwt-auth.guard.ts` (new), `src/shared/auth/` support files (new) | KAN-6 decision | 1d |
| 2 | Add `@VersionColumn()` to the six resource entities + migration | `src/modules/resources/entities/*.ts`, `src/shared/database/migrations/<ts>-resource-versioning.ts` (new) | none | 0.5d |
| 3 | `resource_audit_log` table + entity + write-path helper | `src/modules/resources/entities/resource-audit-log.entity.ts` (new), migration (new) | none | 0.5d |
| 4 | `ResourceError` class + factory (mirrors `appointment-errors.ts`) | `src/modules/resources/application/resource-errors.ts` (new) | none | 0.25d |
| 5 | Commands: create/update technician, technician-skill, technician-shift, technician-unavailability, service-bay, service-bay-unavailability, including the conflict-check + `force` override | `src/modules/resources/application/commands/*.ts` (new) | Tasks 1-4 | 3d |
| 6 | `ResourcesController` (routes for each command, Swagger docs, guarded) | `src/modules/resources/presentation/http/resources.controller.ts` (new) | Task 5 | 1d |
| 7 | Wire controller + new providers into `resources.module.ts` | `src/modules/resources/resources.module.ts` | Tasks 1-6 | 0.25d |
| 8 | Unit tests per command (happy path, version conflict, dealership-scope violation, appointment-conflict without/with `force`) | `test/unit/modules/resources/**` (new) | Task 5 | 1.5d |
| 9 | Integration/e2e tests through the real HTTP surface, including the existing booking/concurrency suite re-run to confirm no regression | `test/integration/**`, `test/e2e/**` (new files) | Tasks 6-7 | 1d |

Total: ~9 days, spread across auth groundwork, data-layer changes, application logic, and tests. The critical path is Task 1 (auth) → Task 5 (commands, the largest single task) → Tasks 6-9.

## 8. Data & migration impact

Two migrations: (a) add a `version integer not null default 1` column to each of the six resource tables (`technicians`, `technician_skills`, `technician_shifts`, `technician_unavailability`, `service_bays`, `service_bay_unavailability`); (b) create `resource_audit_log` as a new append-only table with foreign keys scoped loosely (entity_type + entity_id, not a hard FK, since it must survive the referenced row's eventual deletion for audit purposes). Both are additive — no backfill needed since this is a fresh table/column, no existing production data exists yet per this repo's own stated status. Rollback: drop the new column/table via `migration:revert`; no data loss risk since nothing depends on them yet.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| KAN-6's auth guard doesn't exist yet when this ticket is picked up, forcing KAN-4 to build it inline (Task 1) | High (KAN-6 is decision-only) | Medium | Explicitly budgeted as Task 1 in this plan rather than treated as a silent blocker; if another ticket builds the guard first, Task 1 shrinks to "wire the existing guard," not disappear. |
| The `force: true` override on shift/unavailability conflicts is misused to silently break bookings in practice, defeating the safety intent | Low | High | Override is always audit-logged (Section 5) with the acting admin's identity, making misuse attributable and reviewable after the fact, even though it isn't prevented outright. |
| Six entities × create/update commands is a lot of near-identical boilerplate, risking copy-paste drift in validation logic | Medium | Low | A shared base command/validator for the common concerns (dealership-scope check, version check) factored out during Task 5, applied to all six, rather than reimplemented per entity — call this out in code review rather than pre-designing a generic framework speculatively. |

## 10. Test strategy

- **Unit:** one suite per command — happy-path create/update, `403` on dealership mismatch, `412` on stale version, `409` on appointment conflict without `force`, success-with-audit-entry when `force: true` is used.
- **Integration/e2e:** real HTTP requests through the guard (using a test JWT signed with a locally-generated key per KAN-6's testability requirement — no live Cognito needed), confirming the full request/response contract including error envelopes.
- **Regression:** re-run the existing `pnpm test:concurrency` suite unchanged after this ticket lands — resource mutation must not weaken the appointments table's exclusion-constraint guarantees, since those constraints live on a different table and this ticket never touches `appointments` directly, but the regression run is the actual proof, not an assumption.

## 11. Rollout & rollback

New, additive endpoints and tables — no existing behavior changes. Feature can ship directly once auth (Task 1) is in place; no flag needed since nothing currently depends on these routes existing. Rollback is reverting the migrations (Section 8) and the new module code; the `appointments` module and its existing endpoints are never touched by this ticket, so rollback carries no risk to the booking path.

## 12. Open questions

- **Owner and timeline for KAN-6's actual guard implementation** (see Section 9's top risk) — this plan budgets building it inline if needed, but that's a coordination question the two tickets' owners should resolve, not something this plan alone can settle.
- **Import/idempotency contract for upstream dealer-management systems** (Section 5, point 5) — deliberately deferred; open until a real upstream integration is scoped.
- Should the `force: true` override on a conflicting shift/unavailability change also require a *second* explicit confirmation step (e.g. a two-phase "preview the affected appointments, then confirm"), or is a single flag with audit logging sufficient? This plan chose the simpler single-flag approach (Section 5, Section 6) but flags it as a product-judgment call, not a purely technical one.
