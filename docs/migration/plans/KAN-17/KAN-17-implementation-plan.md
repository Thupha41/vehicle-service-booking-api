# KAN-17 — Environment Configuration & Secrets Management

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-17
- **Type / Status / Priority:** Story / To Do / High (Size S)
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Wrong or missing configuration should fail fast at startup, not surface as a confusing runtime error later — and no credential should ever live in the image or the repo. The ticket was written as a fresh-start backlog item, but this codebase already has a 133-line `validateEnvironment()` function (`src/shared/config/environment.ts`) and a multi-stage Dockerfile. This plan grounds the ticket's three acceptance criteria against that real code, in particular confirming — not assuming — that `validateEnvironment` is actually wired into NestJS's startup path.

## 2. Scope

### In scope

- Verify `validateEnvironment()`'s failure behavior against AC1 (fail fast, name the offending variable).
- Confirm whether `validateEnvironment` is actually passed to `ConfigModule.forRoot({ validate: ... })` — this was explicitly unverified going in.
- Verify the Dockerfile and `.dockerignore` for secret leakage into the image (AC2).
- Document, honestly, what is and isn't covered for runtime secret injection in non-local environments (AC3) — a deployment-platform concern this repo cannot fully own.
- Add the missing "Evidence to attach" artifact: a test demonstrating startup failure on a missing required variable.

### Explicitly out of scope

- Standing up secrets-manager infrastructure itself (ticket marks this out of scope explicitly).
- Replacing the hand-rolled validators with a schema library (zod/joi) — the existing validators already satisfy every AC as written.

## 3. Assumptions

- "Fails immediately with a clear message naming the offending variable" is satisfied by `Error` messages that name the variable (e.g. `"DATABASE_URL is required"`, `"LOG_LEVEL is not supported: xyz"`), consistent with the existing style — a formal error-code scheme is not required.
- "Secrets injected at runtime from a secrets manager" in non-local environments is a deployment-platform decision outside this repo's code; this plan verifies the repo does nothing to *prevent* that (no baked-in secrets, config read from `process.env`) rather than claiming the injection mechanism itself is "done" in code.

## 4. Current behaviour

- `validateEnvironment()` (`src/shared/config/environment.ts:84-125`) throws a plain `Error` with a variable-naming message for missing/invalid `NODE_ENV` (:88-90), `LOG_LEVEL` (:93-95, via a `LOG_LEVELS` allow-set), `PORT` (:100, via `parseInteger`, range 1-65535), `DATABASE_URL` (:101, via `validateDatabaseUrl`:65-82, which requires the value to parse as a URL with a `postgres:`/`postgresql:` protocol), `DATABASE_SSL` (:102, strict boolean parse), `CORS_ORIGINS` (:104), `OTEL_*` (:105-115), and `RATE_LIMIT_*` (:116-123).
- **Wiring confirmed.** `src/app.module.ts:21-26`:
  ```ts
  ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    envFilePath: ['.env.local', '.env'],
    validate: validateEnvironment,
  }),
  ```
  `validateEnvironment` is passed directly as `ConfigModule`'s `validate` option. NestJS calls this synchronously against `process.env` during module initialization and propagates any thrown error, failing app bootstrap before any other module (including `TypeOrmModule`, which itself calls `config.getOrThrow(...)` in `app.module.ts:39-43`) can initialize. **This resolves the task brief's open question: the wiring is real and correct — this is not a gap.**
- **Dockerfile secrets.** Confirmed 3-stage build (`dependencies`:1-5 / `build`:7-13 / `runtime`:15-24). Every `COPY` instruction in every stage is an explicit allowlist — `COPY package.json pnpm-lock.yaml ./` (deps, :4), `COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json nest-cli.json ./` + `COPY src ./src` (build, :11-12), `COPY package.json pnpm-lock.yaml ./` + `COPY --from=build /app/dist ./dist` (runtime, :19-21). **There is no `COPY . .` anywhere**, so `.env`/`.env.local` cannot enter any image layer regardless of `.dockerignore` content — a stronger guarantee than a `.dockerignore` exclusion alone. The runtime stage runs `USER node` (:22, non-root).
- **`.dockerignore`** (`F:\Unified Service Scheduler\.dockerignore:1-8`) excludes `node_modules`, `dist`, `coverage`, `.git`, `.env`, `.claude`, `.agents`, `tmp`. It lists the literal `.env` but **not** `.env.*` — unlike `.gitignore`, which has both `.env` and `.env.*` with a `!.env.example` carve-out (`.gitignore:4-6`). Given the Dockerfile's explicit-allowlist `COPY` pattern above, this gap is currently inert (nothing would ever copy `.env.local` in), but it is a defense-in-depth omission that would matter if a future change introduced a broader `COPY . .`.
- **Runtime secret injection for non-local environments** is outside this repo's control by design: the app reads `DATABASE_URL` etc. from `process.env`/`.env` via `ConfigModule`, but *how* those env vars are populated in a deployed environment (a secrets manager, an orchestrator's injected env) is a deployment-platform decision. `README.md:145` notes `DATABASE_SSL` must be `true` in cloud deployments as a related operational note. Documenting this honestly rather than claiming it's "done" in code.

**Gap found (evidence/test coverage).** No test exercises `validateEnvironment()`'s failure paths — confirmed via glob (`src/shared/config/` contains only `environment.ts` and `database-options.ts`, no spec file) and a repo-wide search for "environment" under `test/**` (no matches). KAN-17's "Evidence to attach" line (a test demonstrating startup failure on a missing required variable) is currently unmet. There is also no documented "image scan" evidence step.

## 5. Proposed approach

DONE for both code-level ACs: fail-fast validation is real and correctly wired into `ConfigModule` (Section 4 resolves the one thing that genuinely needed verifying); no secrets in the image is real and structurally guaranteed by the Dockerfile's explicit `COPY` allowlist, not just enforced by `.dockerignore` policy. No production code change is needed to `environment.ts`, `app.module.ts`, or the Dockerfile's structure. Three small, additive tasks close the remaining evidence gaps: a unit test for the validator's failure paths, a one-line `.dockerignore` hardening addition, and a documented one-command image-inspection evidence step.

## 6. Alternatives considered and rejected

- **Introduce a schema library (zod/joi) to replace the hand-rolled validators.** Rejected — the existing validators already satisfy every AC (name the offending variable, fail immediately, run at startup); swapping libraries is a rewrite with no ticket-mandated benefit, and risks changing error-message wording in a way that regresses the "clear message naming the offending variable" AC without adding capability.
- **Add a full image-scanning tool (Trivy/Grype) to CI as the evidence artifact.** Considered but deferred to Open Questions — a legitimate stronger version of the evidence line, but heavier than needed to close the ticket's literal AC; a documented one-command layer-inspection check satisfies "an image scan showing no embedded secrets" without adding a new CI dependency nobody asked for.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add `environment.spec.ts` covering: missing `DATABASE_URL`, malformed `DATABASE_URL` (bad protocol / not a URL), invalid `NODE_ENV`, invalid `LOG_LEVEL`, out-of-range `PORT`/`RATE_LIMIT_MAX` — each asserting `validateEnvironment` throws with a message naming the variable | `src/shared/config/environment.spec.ts` (new) | none | 0.5d |
| 2 | Add `.env.*` to `.dockerignore` (alongside the existing literal `.env`) as defense-in-depth | `.dockerignore` | none | 0.1d |
| 3 | Document a one-command evidence step for the "image scan" evidence line: `docker build -t uss:scan . && docker run --rm uss:scan sh -c "find / -xdev -iname '*.env*' 2>/dev/null"`, expected to return nothing | this plan (Section 10); optionally `README.md` | Task 2 | 0.25d |
| 4 | Run `pnpm test:unit`, `pnpm lint`, `pnpm typecheck` | n/a | Task 1 | 0.15d (buffer) |

Total: ~1 day. One new test file, one `.dockerignore` line, no production code changes.

## 8. Data & migration impact

None.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| New `environment.spec.ts` asserts on exact `Error` message text and becomes brittle if messages are refactored | Low | Low | Assert on substring/variable-name presence, matching the AC's wording ("naming the offending variable"), not full string equality. |
| `.dockerignore`'s `.env.*` addition has no observable effect today (already covered by the explicit `COPY` allowlist), so it could be read as unnecessary churn | Low | Low | Documented explicitly in this plan (Section 4) as defense-in-depth, not a fix for an active leak. |
| A future change adds `COPY . .` to the Dockerfile without re-checking secrets exposure, silently removing the current structural guarantee | Medium | High | Out of scope to prevent beyond the `.dockerignore` hardening in Task 2; flagged in Open Questions as a guardrail worth a CI check if the Dockerfile's `COPY` pattern ever changes. |

## 10. Test strategy

- **Unit only** (`pnpm test:unit`): five negative cases against `validateEnvironment()` called directly — no NestJS bootstrap needed, matching how a pure function should be tested.
- No new e2e test needed: the existing e2e suite already implicitly proves valid env vars boot the app successfully on every CI run (`.github/workflows/ci.yml`'s `env:` block, lines 25-37, supplies valid values, and the app must start for later steps like `pnpm test:e2e` to run at all) — adequate positive-path coverage. This ticket only lacked the negative-path evidence, which Task 1 adds.

## 11. Rollout & rollback

New test file plus one `.dockerignore` line; zero production behavior change (`Dockerfile`, `app.module.ts`, `environment.ts` are untouched). Rollback is a plain revert of the commit.

## 12. Open questions

- Should CI add a real image-scanning step (Trivy/Grype) as a permanent guardrail rather than a one-off documented command? Not required by KAN-17's literal AC (which asks for "an image scan showing no embedded secrets" as evidence to attach once, not a recurring CI gate) — flagged as a possible follow-up ticket rather than silently expanding this one's scope.
- Should a lint/CI check assert the Dockerfile never introduces a `COPY . .`-style instruction, to keep the current "explicit allowlist" secrets guarantee durable against future edits? A real but separate hardening idea, related to the Section 9 risk row, not required by KAN-17's literal ACs.
