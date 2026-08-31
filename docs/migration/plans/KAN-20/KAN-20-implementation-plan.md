# KAN-20 — API Documentation (OpenAPI/Swagger)

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-20
- **Type / Status / Priority:** Story / To Do / Low (Size XS)
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Anyone consuming this API needs a live, accurate contract, not hand-maintained docs that drift from the code. The ticket was written as a fresh-start backlog item, but this codebase already wires up `@nestjs/swagger` (`src/shared/http/swagger.ts`), decorates its controllers with `@Api*` metadata, and runs `openapi:generate` in CI (`.github/workflows/ci.yml:60`). This plan verifies the ticket's three acceptance criteria against that real code — most importantly, whether CI running the generator actually *catches* drift, or just silently regenerates a file with no diff-check, which was flagged going in as the most likely real gap.

## 2. Scope

### In scope

- Verify `swagger.ts`'s wiring (interactive UI + raw JSON) against AC1.
- Spot-check `appointments.controller.ts`'s `@Api*` decorator coverage for error responses, per the task brief's instruction.
- Determine exactly what `scripts/generate-openapi.ts` does, and whether CI's invocation of it constitutes a drift check or just silent regeneration — the AC2 question.
- If AC2 is unmet (it is — see Section 4), propose the smallest fix that closes it.

### Explicitly out of scope

- Publishing docs to an external developer portal (ticket marks this out of scope explicitly).
- A full audit of every controller in every module for `@Api*` coverage — the task brief asked for a spot check of `appointments.controller.ts`; broadening further is noted as an optional follow-up in Work Breakdown, not forced into this ticket's scope.

## 3. Assumptions

- "An undocumented change is caught, not silently merged" (AC2) requires CI to **fail the build** when the regenerated OpenAPI JSON differs from the version committed to the repo. Regenerating the file successfully every run, with no comparison against a tracked baseline, does not satisfy this AC even though the generation step itself never errors.

## 4. Current behaviour

- **`src/shared/http/swagger.ts`** (35 lines): `createOpenApiDocument()` builds a `DocumentBuilder` config (title, description, version, 3 tags: Availability/Appointments/Health) and calls `SwaggerModule.createDocument()`. `configureSwagger()` mounts it at `/docs` via `SwaggerModule.setup('docs', ..., { jsonDocumentUrl: 'openapi.json', ... })` (:26-32), so raw JSON is served at `/openapi.json` alongside the interactive UI — matches "interactive docs generated from code-level annotations, not written by hand."
- **`src/modules/appointments/appointments.controller.ts`** (133 lines) — spot-checked all four endpoints per the task brief:
  - `checkAvailability` (:41-60): `@ApiOperation`, `@ApiOkResponse` (typed `AvailabilityResponseDto`), `@ApiBadRequestResponse`, `@ApiNotFoundResponse`, both error responses typed to `ErrorResponseDto`.
  - `book` (:62-110): `@ApiOperation`, `@ApiHeader` (Idempotency-Key), `@ApiCreatedResponse`, `@ApiBadRequestResponse`, `@ApiNotFoundResponse`, `@ApiUnprocessableEntityResponse`, `@ApiConflictResponse` **with a concrete JSON example** (:89-98) — the richest-documented endpoint, covering 400/404/409/422 alongside the happy path.
  - `getById` (:112-117): `@ApiOkResponse`, `@ApiNotFoundResponse`.
  - `cancel` (:119-132): `@ApiOkResponse`, `@ApiNotFoundResponse`, `@ApiConflictResponse`.

  All four endpoints document at least one non-happy-path response typed to a shared `ErrorResponseDto`, and every schema (`AppointmentResponseDto`, `AvailabilityResponseDto`, `CheckAvailabilityDto`, `BookAppointmentDto`) is generated from a real TypeScript class, not hand-written — satisfies AC1's "schema, example, and documented error responses" for this module. This is a spot check of one controller as instructed, not a blanket claim for every module in the repo.

- **`scripts/generate-openapi.ts`** (26 lines): boots a headless Nest app (`{ logger: false }`), calls `createOpenApiDocument(app)`, and `writeFile`s the result to `openapi/openapi.json` (:16-20), then closes the app. **It performs no comparison against any existing file** — `writeFile` (:20) unconditionally overwrites whatever is at that path. There is no `readFile` + diff, no `git diff --exit-code`, no checksum comparison anywhere in this script.
- **`.github/workflows/ci.yml`**: `pnpm openapi:generate` runs as the **last** step (:60), after build (:59) and all test suites (:55-58). It is not followed by any verification step — no `git diff --exit-code openapi/`, no `git status --porcelain` check, nothing. **Confirmed real gap**: CI regenerates `openapi/openapi.json` on every run, but never checks whether the regenerated content differs from what's committed — a schema/route change whose decorators drift from the real handler would regenerate a *different* file, and the CI run would still pass, because nothing compares the two. This directly contradicts AC2 ("an undocumented change is caught, not silently merged").
- **`openapi/openapi.json`** exists on disk at the repo root (confirmed via glob) but is currently **untracked by git** (`git status --short openapi/` → `?? openapi/`) — consistent with this repo's overall state (only `README.md` is a tracked modification per the initial repo status; most other files, including `.gitignore` itself, are also pending the project's first real commit). `.gitignore` does not list `openapi/`. For a `git diff --exit-code`-style drift check to work at all, `openapi/openapi.json` must first be committed as the tracked baseline — a prerequisite for the fix, not a separate issue.

## 5. Proposed approach

Found a real gap, exactly as anticipated in the task brief. AC1 (interactive docs with schema, example, and error responses) and AC3 (a consumer can construct a valid request from the docs alone) are already satisfied by the existing `swagger.ts` wiring and the controller decorator coverage above — no change needed there. **AC2 is not satisfied**: CI runs the generator but performs no drift check. The fix is small and additive:

1. Commit `openapi/openapi.json` as the tracked baseline.
2. Add one CI step immediately after `pnpm openapi:generate` that fails the build if the working tree is now dirty (`git diff --exit-code -- openapi/`), which catches exactly the class of drift the AC describes — a schema/route change whose decorators weren't updated to match.

## 6. Alternatives considered and rejected

- **Add a dedicated OpenAPI-linting tool (e.g. Spectral) to CI.** Rejected as the primary fix — it solves a different problem (style/best-practice linting of the spec), not AC2's literal ask (catching undocumented drift against a committed baseline). Noted as a possible complementary follow-up in Open Questions.
- **Compare via a checksum/hash script instead of `git diff --exit-code`.** Rejected — `git diff --exit-code` needs no new script or dependency and is the standard idiom for "fail CI if generation produced an uncommitted change."
- **Regenerate the spec twice in CI and diff the two outputs, to catch non-determinism.** Rejected — this doesn't address the actual AC (catching an undocumented *code* change against a committed baseline), and the generator's output is already deterministic (same `DocumentBuilder` config plus the same decorated classes each run), so this would only catch a different, less relevant class of bug.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Commit `openapi/openapi.json` as the tracked baseline (run `pnpm openapi:generate` once, `git add openapi/openapi.json`) | `openapi/openapi.json` | none | 0.1d |
| 2 | Add a CI step after the existing `pnpm openapi:generate` (`ci.yml:60`) that fails the build on drift: `git diff --exit-code -- openapi/` | `.github/workflows/ci.yml` | Task 1 | 0.25d |
| 3 (optional, not required to close this ticket) | Broaden the Section 4 spot check into a full audit of every controller's `@Api*` error-response coverage across all modules (vehicles, resources, reference-data, health) | n/a (audit only, or new decorators per finding) | none | 0.5-1d if taken |

Total: ~0.5 day for the real fix (Tasks 1-2); Task 3 is optional and separately scoped.

## 8. Data & migration impact

None.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Committing `openapi/openapi.json` means every future schema/route change must remember to run `pnpm openapi:generate` locally and commit the diff, or CI fails | Medium | Low | This is the intended behavior per AC2 — the CI failure is a feature, and `git diff`'s output shows exactly what changed. |
| `openapi/openapi.json` diffs on every PR that touches any DTO/decorator, becoming review noise | Low | Low | Standard tradeoff for generated-artifact-drift checks, and the explicit tradeoff AC2 asks for; no mitigation needed beyond normal PR review of the generated diff. |
| `openapi/` was possibly left untracked deliberately (treated like `dist/`, a build artifact), and committing it reverses that intent | Low | Medium | Checked `.gitignore` (`F:\Unified Service Scheduler\.gitignore`) — `openapi/` is not listed; its untracked status is explained by the whole repo being pre-first-commit for most files, not a deliberate exclusion. Flagged in Section 12 for explicit confirmation before committing it. |

## 10. Test strategy

No unit/integration/e2e test is needed — this is a CI pipeline change, not application logic. Verification is procedural: after Task 2, temporarily remove one `@ApiOkResponse` decorator, confirm the new CI step fails, then revert and confirm it passes cleanly. That before/after run is the evidence artifact KAN-20's own "Evidence to attach" line (a CI step generating/validating the OpenAPI artifact) asks for.

## 11. Rollout & rollback

Purely additive: one newly committed file plus one new CI step; no application code touched, no behavior change for running instances. Rollback is reverting the CI step and, optionally, un-tracking `openapi/openapi.json`.

## 12. Open questions

- Confirm with the repo owner whether `openapi/openapi.json` should be git-tracked going forward — this plan assumes yes, since that's the only way a `git diff`-based drift check can work, and no `.gitignore` entry currently excludes it. Flagged rather than assumed silently, since committing a previously-untracked directory is a small but real decision.
- Should Task 3 (a full controller audit for `@Api*` coverage across every module) be scoped as part of this ticket, or spun into a separate follow-up? The spot check requested in the task brief (`appointments.controller.ts`) is complete and strong; broadening to every module is additional scope not explicitly asked for by KAN-20's ACs.
- Should Spectral (or similar OpenAPI linting) be added later as a complementary check (style/best-practices) alongside the drift check proposed here? Not required by KAN-20's literal ACs; noted as a possible enhancement.
