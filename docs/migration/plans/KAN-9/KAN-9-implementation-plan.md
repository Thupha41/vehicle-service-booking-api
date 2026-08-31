# KAN-9 — Observability: Structured Logging

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-9
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Every request needs a structured, correlatable log trail without leaking sensitive data into logs — a request ID on every log line, an explicit redaction list for auth headers/cookies/PII, and an environment-sensible log-level policy. The ticket was written as a fresh-start backlog item ("no logging exists yet"), but this codebase already has running code in this area (`src/shared/observability/logging.ts`). This plan grounds the ticket against that real code before proposing changes.

## 2. Scope

### In scope

- Verify KAN-9's three acceptance criteria against the current implementation.
- Confirm the logging options builder (`createPinoLoggerOptions`) is actually wired into the app, not just defined and unused.
- Close the one real gap found: no dedicated test exists for the redaction behavior KAN-9 explicitly asks for evidence of ("A test asserting a defined PII field never appears in log output").

### Explicitly out of scope

- Standing up a log aggregation platform — KAN-9 marks this out of scope explicitly (stdout/stderr collection is assumed to be handled by the deploy platform).
- Any change to the redaction list's contents, the request-ID generation scheme, or the per-status log-level policy — all three already satisfy the ticket's acceptance criteria as written; this plan does not touch their shape.
- Changes to `GlobalExceptionFilter` (`src/shared/http/global-exception.filter.ts`) — that surface is owned by KAN-16, which has already been ground-truthed and (per current source) implemented in a prior pass.

## 3. Assumptions

- "Defined PII field" in KAN-9's evidence line refers to the fields already enumerated in `SENSITIVE_LOG_PATTERNS` (`logging.ts:23-51`), not a new field list to be designed — the ticket doesn't name specific fields, so the existing list (email, phone, VIN, customer/full name, SSN, credit card, plus auth/secret patterns) is treated as satisfying "defined PII fields."
- "Request ID... propagated from a safe client-supplied header, or generated otherwise" is satisfied by validating the incoming `x-request-id` against a strict allowlist regex before trusting it (`SAFE_REQUEST_ID`, `logging.ts:16`), not by accepting any client-supplied value verbatim — this is a stricter reading than the ticket's literal text but consistent with its intent ("safe").
- The "unhandled exception... client response omits internal detail" clause overlaps with KAN-16's scope (`GlobalExceptionFilter`); this plan cites that filter's current behavior as supporting evidence rather than re-verifying it from scratch, since KAN-16's grounding pass already covers it.

## 4. Current behaviour

All three acceptance criteria are already implemented and wired into the running app:

- **JSON structured logs, wired in:** `createPinoLoggerOptions()` (`src/shared/observability/logging.ts:60-109`) returns a `nestjs-pino` `Params` object. `src/app.module.ts:27-35` calls `LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: (config) => createPinoLoggerOptions(...) })`, so the options builder is not dead code — it's the actual logger configuration for the app. `main.ts:37` (`app.useLogger(app.get(Logger))`) makes it Nest's active logger.
- **Request ID on every log line, propagated or generated:** `genReqId` (`logging.ts:70-74`) calls `getRequestId(request)`, which validates any client-supplied `x-request-id` header against `SAFE_REQUEST_ID` (`:16, 53-58`) and falls back to `randomUUID()` if absent or unsafe; the resolved ID is written back onto the response via `response.setHeader('x-request-id', requestId)` (`:72`) and attached to every log line via `customProps` (`:81-86`, `requestId: request.id`).
- **Explicit redaction list, auth/cookie/PII never printed:** `SENSITIVE_LOG_PATTERNS` (`logging.ts:23-51`) lists auth headers (`req.headers.authorization`, `req.headers.cookie`, API-key/idempotency-key headers), secrets (`*.password`, `*.token`, `*.secret`, `*.apiKey`, `*.privateKey`), PII (`*.email`, `*.phone`, `*.phoneNumber`, `*.customerName`, `*.fullName`, `*.vin`, `*.ssn`, `*.creditCard`), and infra secrets (`*.databaseUrl`, `*.dbUrl`, `*.connectionString`). This list is passed into pino's `redact.paths` (`:96-99`) with `censor: '[REDACTED]'`, and an `additionalRedactPaths` parameter lets call sites extend it without touching this file.
- **Log level policy differs by environment:** `customLogLevel` (`:87-95`) maps 5xx/errors to `error`, 4xx to `warn`, else `info`; `pinoHttp.level` is forced to `'silent'` in the `test` environment (`:69`) and `autoLogging` is disabled entirely in `test` (`:76-77`) except it always ignores `/health/live` (`:79`) to avoid liveness-probe log spam; the transport is `pino-pretty` (colorized, single-line) only in `development` (`:100-106`), structured JSON otherwise.
- **Unhandled exception: error/stack captured server-side, response sanitized:** `GlobalExceptionFilter` (`src/shared/http/global-exception.filter.ts:60-64`) logs the full exception object (`err: exception`) via the same Pino logger for every 5xx, while `buildErrorBody()` (`src/shared/http/error-body.ts:58-80`) sends the client a generic `'An unexpected error occurred'` message and omits `details` entirely for `status >= 500` (`error-body.ts:73`). This is KAN-16's surface, cited here only as supporting evidence for KAN-9's third AC — see Section 2, out of scope.

**Gap found (test coverage):** `test/**` has no file referencing `logging.ts`, `SENSITIVE_LOG_PATTERNS`, or `createPinoLoggerOptions` (confirmed via a repo-wide grep across `test/`, zero matches). More broadly, no `test/unit/` directory exists in the repo at all yet — only `test/integration/`, `test/e2e/`, and `test/concurrency/` are populated. `test/jest-unit.json` (`testPathIgnorePatterns: ["/test/integration/", "/test/e2e/", "/test/concurrency/"]`, `rootDir: ".."`) already supports a `test/unit/**/*.spec.ts` layout without any config change — it's simply unused so far. This matches KAN-9's own "Evidence to attach" line ("A test asserting a defined PII field never appears in log output"), which doesn't exist yet.

## 5. Proposed approach

**DONE, with one small gap.** No production code change is needed — `logging.ts` already implements every acceptance criterion and is correctly wired into `app.module.ts`. The only real gap is test evidence: add a focused unit test that calls `createPinoLoggerOptions(...)` directly and asserts its `redact.paths` array actually contains the PII/secret patterns KAN-9 cares about, plus a behavioral assertion (build a pino logger with these options, log an object containing a sensitive field, and assert the serialized output shows `[REDACTED]` and never the raw value). This directly produces the evidence artifact KAN-9's own ticket asks for.

## 6. Alternatives considered and rejected

**Add an e2e test that sends a real HTTP request with a PII field and inspects captured log output** — rejected as the primary approach: capturing `nestjs-pino`'s actual stdout stream in an e2e harness is significantly more complex (requires intercepting the Pino destination stream or redirecting `process.stdout`) than asserting against the `redact.paths` config and pino's own serialization directly. A direct unit test against `createPinoLoggerOptions()`'s output is faster, deterministic, and matches what the ticket's Evidence line asks for (redaction behavior, not full-stack log delivery). This can be revisited if a future ticket needs true end-to-end log-pipeline coverage.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add `logging.spec.ts`: assert `SENSITIVE_LOG_PATTERNS` covers the PII/auth/secret fields named in KAN-9; build a real `pino()` instance from `createPinoLoggerOptions(...).pinoHttp`, log a payload with a sensitive field (e.g. `{ user: { email: 'a@b.com' } }`), capture the write stream, and assert the serialized line contains `[REDACTED]` and never the raw email | `test/unit/shared/observability/logging.spec.ts` (new) | none | 0.5d |
| 2 | Assert `customLogLevel` maps 5xx→error, 4xx→warn, else→info, and that `genReqId` propagates a valid client `x-request-id` unchanged while rejecting/replacing an unsafe one | same file | Task 1 | included above |
| 3 | Run `pnpm test:unit`, confirm the new spec passes and nothing else regresses | n/a | Tasks 1-2 | 0.1d (buffer) |

Total: ~0.5 day. No production files touched, one new test file.

## 8. Data & migration impact

None. No schema, entity, or migration touched — this ticket is test coverage over existing behavior.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Asserting against pino's internal redaction serialization format is brittle across `pino`/`pino-http` version bumps | Low | Low | Assert on the presence of the censor string (`'[REDACTED]'`) and absence of the raw sensitive value, not on the exact JSON key ordering or full line shape. |
| The new `test/unit/` directory is the first of its kind in this repo; a config assumption about `jest-unit.json` picking it up could be wrong | Low | Low | `test/jest-unit.json`'s `testRegex`/`rootDir`/ignore-list were read directly (Section 4) and confirmed compatible with `test/unit/**/*.spec.ts` before writing the plan; verify with a real `pnpm test:unit` run in Task 3 rather than assuming. |
| Ticket is later reopened because "structured logging" reads as a from-scratch build in the original ticket text | Low | Low | This plan documents the conflict explicitly (Section 4) so the ticket's status reflects reality instead of silently diverging from it. |

## 10. Test strategy

- **Unit only** (`pnpm test:unit`): one new spec file exercising `createPinoLoggerOptions()` directly — no database, no HTTP server, no real Nest app bootstrap.
- Coverage added: redaction of a representative PII field end-to-end through pino's serializer (not just the presence of a string in a config array), per-status log-level mapping, and request-ID propagation/generation behavior.
- No e2e or integration changes — the existing `test/e2e/appointments.e2e.spec.ts` incidentally exercises the logger at runtime already (every request logs through it); this plan doesn't duplicate that.

## 11. Rollout & rollback

Test-only change — no production code is modified, so there is no rollout risk and nothing to roll back beyond reverting the new spec file if it turns out to be flaky. Gated by the existing CI pipeline (lint, typecheck, unit/integration/e2e/concurrency tests, build).

## 12. Open questions

- KAN-9 lists no dependencies, but its "Evidence to attach" line ("Sample redacted log output") could alternatively be satisfied by pasting a real log line captured from a manual run rather than a unit test assertion — this plan treats the unit test as the primary evidence and a manual sample as an optional attachment, not a separate work item, since the automated test is strictly stronger (it fails on regression; a static sample does not).
- KAN-16's own Section 12 already flagged that KAN-9 was assumed to be a dependency "for the trace-ID correlation" in KAN-16's original ticket text, but the trace ID actually comes from OpenTelemetry (`logging.ts:85`, `trace.getSpan(context.active())`), independent of the Pino setup itself. No action needed here; noted for whoever triages ticket dependencies.
