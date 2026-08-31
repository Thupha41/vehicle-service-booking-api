# KAN-16 — Global Error Handling & Error Code Standard

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-16
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 2 (post Codex review — see Appendix)

## 1. Problem

Clients need to branch on API errors programmatically (a stable machine-readable code, not just an HTTP status), and operators need to correlate a client-visible error to server-side logs via a trace ID — all without the response leaking internal exception detail. The ticket was written as a fresh-start backlog item ("no error handling exists yet"), but this codebase already has running code in this area (`src/shared/http/global-exception.filter.ts` is open in the user's editor). This plan grounds the ticket against that real code before proposing changes.

## 2. Scope

### In scope

- Verify the three KAN-16 acceptance criteria against the current implementation.
- Close the two real gaps a Codex adversarial review found in that verification (Section 4a, Section 9):
  1. `GlobalExceptionFilter` leaks `payload.details` on 5xx responses even though it sanitizes `message`.
  2. The rate-limit middleware's 429 response bypasses `GlobalExceptionFilter` entirely and uses a different envelope (no `requestId`/`traceId`/`timestamp`/`path`).
- Ship the specific evidence KAN-16 asks for: tests asserting the error-code + trace-ID/request-ID shape for a validation error, a conflict, a 429, and an unhandled exception.

### Explicitly out of scope

- A public error-code reference document (KAN-16 marks this out of scope explicitly).
- Redesigning the domain error taxonomy in `appointment-errors.ts` — it already satisfies the ticket's requirement; this plan does not touch its shape.
- Any change to `nestjs-pino` log redaction config (covered by the structured-logging ticket, KAN-9).

## 3. Assumptions

- "Distinguishable error codes for the same HTTP status" is satisfied by any two constant string codes that differ — the ticket does not require a numbering scheme or an external registry (consistent with "no public error-code reference doc" being out of scope).
- `VALIDATION_ERROR` counts as one failure category with per-field `details`, not one code per invalid field — this matches how the existing `exceptionFactory` in `validation-pipe.ts:27-32` already works, and rewriting it into a per-field code scheme is not implied by the ticket text.
- The trace ID is optional in the response (only present when a span is active), matching current behavior at `global-exception.filter.ts:74` — KAN-16 doesn't require tracing to be mandatory, only that when a trace exists it's surfaced.

## 4. Current behaviour

The three acceptance criteria are already implemented:

- **Global filter, one place:** `GlobalExceptionFilter` (`src/shared/http/global-exception.filter.ts:20-79`) is registered as the sole `APP_FILTER` in `src/app.module.ts:53`, so every unhandled exception in the app funnels through it.
- **Stable code + request/trace ID on every error:** the filter reads `code`/`errorCode` off the exception payload, falls back to `defaultErrorCode(status)` (`global-exception.filter.ts:15-18, 39-40`), and always attaches `requestId` (`:37`) and `traceId` when a span is active (`:38, 74`) to the JSON body (`:66-77`).
- **Generic message for 5xx, no leak:** for `status >= 500` the client message is hardcoded to `'An unexpected error occurred'` (`:42-43`); the raw `exception` (including stack) goes only to the Pino logger (`:51, 60-64`), never into the HTTP response.
- **Distinguishable codes for the same status:** `src/modules/appointments/application/appointment-errors.ts:9-76` defines six domain errors that resolve to `409 CONFLICT` or `422 UNPROCESSABLE_ENTITY`, each with its own `errorCode` (`OUTSIDE_BUSINESS_HOURS`, `SLOT_CONFLICT`, `NO_QUALIFIED_TECHNICIAN`, `NO_COMPATIBLE_SERVICE_BAY`, `IDEMPOTENCY_KEY_REUSED`, `INVALID_APPOINTMENT_TRANSITION`, `VEHICLE_CUSTOMER_MISMATCH`, `START_TIME_IN_PAST`).
- **Validation errors already get a dedicated code:** `createValidationPipe()`'s `exceptionFactory` (`src/shared/http/validation-pipe.ts:19-33`) throws `BadRequestException({ code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [...] })` instead of falling through to the generic `BAD_REQUEST` default.

**Gap found (test coverage):** there is no dedicated test file for `GlobalExceptionFilter` (confirmed by glob search of `test/**` for `*exception*` — no matches). Coverage today is incidental: `test/e2e/appointments.e2e.spec.ts:309,324` asserts `error.code` for a couple of 404 cases as a side effect of testing those endpoints, but nothing exercises the filter's 500-generic-message path, the `traceId` field, or the `VALIDATION_ERROR` shape directly.

### 4a. Gaps found (production code — via Codex adversarial review, both verified against source)

1. **5xx `details` leak.** `global-exception.filter.ts:41-48` sanitizes `message` for `status >= 500` to `'An unexpected error occurred'`, but `:71` copies `payload.details` into the response body unconditionally: `...(payload.details === undefined ? {} : { details: payload.details })`. Any code path that throws an `HttpException` with status ≥ 500 and a `details` field (e.g. `new InternalServerErrorException({ code: 'X', message: 'y', details: {...} })`) leaks that `details` payload to the client, defeating the "unexpected exceptions return a generic message with no internal detail" acceptance criterion. Today nothing in the codebase throws such an exception, so it's latent, not yet triggered — but the filter itself doesn't prevent it, and the plan's original test suite (checking only a plain `Error`) would not catch it.
2. **429 bypasses the global filter and its envelope.** `main.ts:41` mounts `createRateLimitMiddleware(config)` via `express.use(...)` — raw Express middleware, registered before Nest's own request handling takes over. `rate-limit.ts:11-17` gives that middleware its own hardcoded response body: `{ statusCode: 429, error: { code: 'RATE_LIMIT_EXCEEDED', message: '...' } }`. Because this response is written directly by `express-rate-limit`, it never reaches `GlobalExceptionFilter`, so it has no `requestId`, no `traceId`, no `timestamp`, and no `path` — a different envelope shape from every other error in the API, breaking the "every error response carries a request/trace ID" acceptance criterion specifically for the one status code most likely to fire under real load.

KAN-16's own "Evidence to attach" line ("tests asserting the error-code + trace-ID shape for a validation error, a conflict, and an unhandled exception") doesn't exist yet, and per the findings above, even a straightforward version of those tests would not have caught either gap — the 5xx-details case needs a purpose-built exception, and the 429 case needs a test that goes through Express middleware, not just the filter in isolation.

## 5. Proposed approach

No longer test-only. Two small production fixes, plus the test suite, matching the ticket's Evidence line and its three ACs:

**Fix 1 — stop leaking `details` on 5xx.** In `global-exception.filter.ts`, gate the `details` spread the same way `message` is already gated: only include `payload.details` when `status < 500`. A 5xx response carries `code`, the generic `message`, `requestId`, `timestamp`, `path`, and `traceId` when present — nothing else.

**Fix 2 — give the 429 response the same envelope as every other error.** Replace the rate-limiter's hardcoded `message` object in `rate-limit.ts` with a handler that reuses the same shape `GlobalExceptionFilter` produces (`statusCode`, `error.code`, `error.message`, `requestId`, `traceId` when present, `timestamp`, `path`). `express-rate-limit` supports a `handler` option (an Express `(req, res) => void` callback) in place of a static `message` — build the envelope there, reading `req.id`/`x-request-id` and the active OTel span the same way the filter does, so the two code paths stay in sync (a small shared `buildErrorBody(status, code, message, request)` helper in `src/shared/http/` is the natural place, used by both `global-exception.filter.ts` and `rate-limit.ts`, to avoid duplicating the envelope logic per Codex's "collapse under one owner" note).

**Test suite** — a focused unit test file for `GlobalExceptionFilter` (constructing it directly with a mock `PinoLogger` and a mock `ArgumentsHost`), plus one middleware-level test for the rate limiter:

1. **Validation error** — feed an exception shaped like `validation-pipe.ts`'s output (`BadRequestException` with `{ code: 'VALIDATION_ERROR', ... }`) and assert `error.code === 'VALIDATION_ERROR'`, `requestId` present and equal to a known injected value, `statusCode === 400`.
2. **Conflict** — feed two different existing `appointmentError.*()` exceptions (e.g. `slotConflict()` and `outsideBusinessHours()`) and assert their distinct `error.code` values come through unchanged, proving two different 409s stay distinguishable.
3. **Unhandled exception with a details-shaped payload** — feed both a plain `new Error('boom')` and an `HttpException` constructed with status 500 and a `details` field containing a sentinel value, and assert in both cases: `statusCode === 500`, `error.message === 'An unexpected error occurred'`, **no `details` key in the response body at all**, and the logger's `error()` call received the original exception object (so it isn't silently dropped server-side).
4. **429 through the real middleware** — a supertest-level test hitting a route enough times to trip the limiter, asserting the 429 body has the same shape as the other three cases: `error.code`, `requestId`, `timestamp`, `path` all present.
5. **Request/trace correlation, asserted exactly** — inject a known `x-request-id` on the request in cases 1-3 and assert the exact same value appears in (a) the JSON response `requestId` field and (b) the arguments passed to the mock logger's call, proving response-to-log correlation rather than merely checking presence/absence. Treat `requestId` as the mandatory correlation key (always present, per `logging.ts:53-58`'s `getRequestId`); treat `traceId` as present-when-a-span-is-active and assert its shape (a valid hex trace-id string) only when OpenTelemetry is explicitly enabled in that test's setup, not asserted either way otherwise.

## 6. Alternatives considered and rejected

**Add e2e-only error tests** (spin up the full Nest app and hit real routes to trigger each case) — rejected as the primary approach because triggering a genuine unhandled 500 through the real HTTP stack requires either mocking a repository to throw or relying on an existing bug, which is more brittle than constructing the filter directly and calling `.catch()` with a crafted exception. Unit-level tests against the filter are faster, deterministic, and match what the ticket's Evidence line asks for (the error-code + trace-ID *shape*, not full-stack behavior). E2E coverage for the 404/409 domain cases already exists incidentally and is left as-is.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add `buildErrorBody(status, code, message, request, details?)` shared helper | `src/shared/http/error-body.ts` (new) | none | 0.25d |
| 2 | Fix 1: gate `global-exception.filter.ts`'s `details` spread on `status < 500`; refactor it to use the shared helper | `src/shared/http/global-exception.filter.ts` | Task 1 | 0.25d |
| 3 | Fix 2: replace `rate-limit.ts`'s static `message` with a `handler` using the shared helper | `src/shared/http/rate-limit.ts` | Task 1 | 0.25d |
| 4 | Add `global-exception.filter.spec.ts` with mock `PinoLogger` + mock `ArgumentsHost` harness; cases 1-3 from Section 5 | `test/unit/shared/http/global-exception.filter.spec.ts` (new) | Tasks 2 | 0.5d |
| 5 | Add rate-limit 429-envelope test (case 4) — supertest against a minimal bootstrapped app or the middleware directly | `test/integration/shared/http/rate-limit.spec.ts` (new) — location TBD against existing integration-test conventions | Task 3 | 0.5d |
| 6 | Exact request-ID correlation assertions (case 5) folded into Tasks 4-5, not a separate file | same files | Tasks 4, 5 | included above |
| 7 | Run full suite (`pnpm test:unit`, `pnpm test:integration`), fix any regression | n/a | Tasks 1-6 | 0.25d (buffer) |

Total: ~2 days. One new shared file, two small edits to existing shared files, two new test files.

## 8. Data & migration impact

None. No schema, entity, or migration touched — this ticket is test coverage over existing behavior.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Extracting a shared `buildErrorBody` helper subtly changes existing response shape for cases not covered by new tests | Medium | Medium | Diff the helper's output against the filter's current inline object field-by-field before switching the filter to use it; run full `test:e2e` (which already has incidental error-code assertions) as a regression check, not just the new unit tests. |
| `express-rate-limit`'s `handler` option has different signature/behavior across the installed version vs. assumed API | Low | Medium | Confirm against the installed `express-rate-limit` version's TypeScript types before writing Task 3; the `handler(req, res, next, options)` signature has been stable since v6, but verify against `package.json`'s pinned version. |
| Mocking `ArgumentsHost`/Express `Request`/`Response` incorrectly produces false-positive passing tests | Low | Medium | Assert on the actual `response.status().json()` call arguments (via a jest mock), not on internal filter state; mirror the real `RequestWithId` shape used in production. |
| Exact request-ID correlation assertion is flaky if the mock logger call shape doesn't match production `logContext` exactly | Low | Low | Assert against the same field names the filter already builds (`logContext` at `global-exception.filter.ts:50-58`), not a hand-rolled shape. |
| Ticket is later reopened because "no error handling" was the literal ask | Low | Low | This plan documents the conflict explicitly (Section 4) so the ticket's status reflects reality instead of silently diverging from it. |

## 10. Test strategy

- **Unit only** (`pnpm test:unit`): the five cases in Section 7, run against `GlobalExceptionFilter` directly with mocked collaborators — no database, no HTTP server.
- Failure cases covered: validation failure, two different domain conflicts (proving code distinguishability), and a non-`HttpException` unhandled error (proving no detail leak). No new happy-path test is needed — this ticket is entirely about error paths.
- Do not touch `test/e2e/appointments.e2e.spec.ts` — its incidental error-code assertions stay as regression coverage for the domain errors, not duplicated here.

## 11. Rollout & rollback

Small, additive production change (two existing files edited, one new shared helper) gated by the existing CI pipeline (`.github/workflows/ci.yml`: lint, typecheck, unit/integration/e2e/concurrency tests, build). No feature flag needed — both fixes are strictly narrowing (removing a field that shouldn't have been sent; adding fields that were missing), so there's no behavior a client could have been correctly depending on. Rollback is a plain revert of the PR; neither fix touches schema, data, or configuration.

## 12. Open questions

- Should `VALIDATION_ERROR` eventually get split into per-field codes (e.g. `VALIDATION_ERROR.dealershipId`) for finer client branching? Not required by KAN-16's acceptance criteria as written; flagged here rather than silently expanding scope. Needs a product decision if raised.
- KAN-16 lists the structured-logging ticket (KAN-9) as a dependency "for the trace-ID correlation" — trace ID here actually comes from OpenTelemetry context (`global-exception.filter.ts:2, 38`), not from the Pino logger itself. The dependency direction in the ticket may be describing log/trace correlation in general rather than a hard build order; this plan doesn't block on KAN-9 since the trace-ID mechanism already works independently. Flagging for whoever triages the two tickets' relationship.
- KAN-9 (structured logging) and KAN-14 (rate limiting) were both written as fresh-start greenfield tickets but, per a separate grounding pass done alongside this one, are already substantially implemented in this repo (`src/shared/observability/logging.ts`, `src/shared/http/rate-limit.ts`). This plan's Fix 2 touches `rate-limit.ts` — coordinate with whoever picks up KAN-14 so the two don't collide on the same file.

## Appendix — Adversarial debate log

### Round 1 — Codex verdict: needs-attention

#### F1.1 — 5xx details can still leak to clients (confidence high)
- **Codex:** `GlobalExceptionFilter` unconditionally copies `payload.details` into every response; a 500/503 `HttpException` carrying sensitive `details` would leak them despite the sanitized `message`. The test-only plan wouldn't catch this.
- **Claude:** ACCEPT — verified at `global-exception.filter.ts:41-48` (message gated on `status >= 500`) vs `:71` (`details` spread with no such gate). Real, exploitable gap in the actual acceptance criteria this ticket claims to satisfy.
- **Plan change:** Section 2 (scope), Section 4a (new), Section 5 (Fix 1), Section 7 (Tasks 1-2), Section 9 (new risk row).

#### F1.2 — Pre-Nest 429 responses bypass the global error contract (confidence high)
- **Codex:** `main.ts` installs `express-rate-limit` before Nest's request handling; its handler emits its own 429 body with no `requestId`/`traceId`/`timestamp`/`path`. Direct filter unit tests can't detect this since the request never reaches the filter.
- **Claude:** ACCEPT — verified `main.ts:41` (`express.use(createRateLimitMiddleware(config))`, registered as raw Express middleware) and `rate-limit.ts:11-17` (hardcoded `message` object, no envelope fields). Confirmed real: this is a genuinely different response shape for the one error most likely to fire under real load.
- **Plan change:** Section 2, Section 4a, Section 5 (Fix 2, shared helper), Section 7 (Tasks 1, 3, 5), Section 9 (new risk row), Section 12 (KAN-14 coordination note).

#### F1.3 — The plan verifies trace omission instead of correlation (confidence medium)
- **Codex:** The original risk mitigation accepted either `undefined` or "any valid-looking ID" for `traceId`, which could pass even if response-to-log correlation were completely broken. Tests should inject a known value and assert exact correlation.
- **Claude:** ACCEPT — the critique of the original Section 9 wording is fair; tightened Section 5's test case 5 to assert exact `requestId` correlation (the field that's unconditionally present, per `logging.ts:53-58`) between response and logger call, and to only assert `traceId`'s *shape* when a span is deliberately active in that test, not its mere presence/absence. Did not adopt Codex's stronger suggestion to make trace IDs mandatory in production — that would require enabling OpenTelemetry by default, which is a separate, unrelated decision (`OTEL_ENABLED` defaults to `false` per `environment.ts:105`, and changing that default is out of this ticket's scope).
- **Plan change:** Section 5 (test case 5, rewritten), Section 9 (risk row on logger-shape flakiness).

### Unresolved

None — all three findings were accepted and incorporated. Round 2 (re-review of the revised plan) was not run in this session; the revised plan should be treated as pending a confirmatory pass before implementation, not as fully re-verified by Codex.
