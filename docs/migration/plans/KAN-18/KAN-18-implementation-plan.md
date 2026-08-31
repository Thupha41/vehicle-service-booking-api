# KAN-18 — CI/CD Pipeline Strategy

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-18
- **Type / Status / Priority:** Story / To Do / Medium
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

KAN-18 was written as a fresh-start ticket assuming no CI/CD exists. The repo already has a real pipeline (`.github/workflows/ci.yml`) that covers most of the ticket's acceptance criteria. Grounding it against the actual workflow file finds one specific, real gap: the pipeline never builds or scans a container image, even though the repo ships a production `Dockerfile`.

## 2. Scope

### In scope

- Verify KAN-18's three acceptance criteria against `.github/workflows/ci.yml` as it exists today.
- Close the one confirmed gap: add an image build + dependency/image scan step.

### Explicitly out of scope

- The actual cloud deployment mechanics (KAN-18 marks this out of scope explicitly — this repo's `README.md`/`SYSTEM_DESIGN.md` describe a target AWS ECS/RDS topology but explicitly state it has not been deployed).
- Publishing the built image to a registry (ECR) — that requires cloud credentials/target infrastructure this repo doesn't have configured; scanning the locally-built image is sufficient to satisfy this ticket's AC without requiring a live push target.

## 3. Assumptions

- "Scans an image before it becomes eligible for deployment" (KAN-18's AC 2) is satisfied by a scan step that fails the workflow on findings above a defined severity threshold — it does not require an actual deployment gate/environment to exist, since there is no deployment job in this repo yet.
- A well-known open-source scanner (e.g. Trivy, via its official GitHub Action) is an acceptable choice — the ticket doesn't name a specific tool, and this repo has no existing security-scanning tooling to match for consistency.

## 4. Current behaviour

`.github/workflows/ci.yml` (61 lines) already implements, confirmed by reading the full file:

- **PR gate (AC 1 — satisfied):** triggers on `push` to `main` and on every `pull_request` (lines 3-6); runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:concurrency` (lines 50, 53-58) — a real PostgreSQL service container is provisioned for the integration/e2e/concurrency suites (lines 11-24), matching this repo's own rule that those tests must run against real PostgreSQL, not SQLite.
- **Controlled migration step (AC 3 — satisfied):** `pnpm migration:run` then `pnpm seed` run as their own distinct pipeline steps (lines 51-52), before any test step — not from the application's own boot path, and not run per-scaled-instance since this is a single CI job.
- **App build (partially satisfies AC 2):** `pnpm build` (line 59) compiles the NestJS app and `pnpm openapi:generate` (line 60) regenerates the OpenAPI spec — but neither of these builds a container image.

**Gap found (AC 2, the actual deliverable):** KAN-18's AC 2 reads "when the pipeline runs, then it builds an image, scans it, and only then makes it eligible for deployment — no untested artifact reaches deploy." The workflow never runs `docker build` against the repo's own `Dockerfile`, and there is no dependency/image scanning step anywhere in the file or in `package.json`'s scripts. This is a real, confirmed gap — not a misreading of already-existing behavior, unlike most of this backlog's other "fresh start" tickets.

## 5. Proposed approach

Add a new job (or additional steps in the existing `verify` job, after `pnpm build` succeeds) that:

1. Builds the production image from the repo's existing multi-stage `Dockerfile` (`docker build -t uss-api:${{ github.sha }} .`) — no `Dockerfile` changes needed, it already exists and matches the app structure.
2. Runs a vulnerability scan against the built image using a well-known GitHub Action (e.g. `aquasecurity/trivy-action`), configured to fail the workflow on `HIGH`/`CRITICAL` findings, so an untested/vulnerable image can't silently pass CI.
3. Does not push the image anywhere — no registry credentials exist in this repo's CI configuration, and pushing is explicitly out of scope (Section 2). The scan step's pass/fail status is itself the "eligible for deployment" gate this ticket asks for; wiring an actual registry push is a separate, later concern once real cloud deployment (out of scope for this repo per its own README) is configured.

Run the new steps only after the existing test suite passes (same job, later steps, or a dependent job with `needs: verify`) so a failing test still blocks the image step from running at all — avoids wasting CI minutes building/scanning an image for code that doesn't pass tests anyway.

## 6. Alternatives considered and rejected

**Add a separate `deploy` workflow file gated on `main`, doing build+push+deploy** — rejected as premature. This repo explicitly documents (`README.md` "Target cloud architecture" / "Not tuning claim of an existing AWS deployment") that no cloud deployment exists yet; building a deploy pipeline with no deployment target to point it at would be speculative infrastructure. Scope this ticket to the CI-side build+scan gate only, matching what KAN-18's own text asks for ("makes it eligible for deployment," not "deploys it").

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add `docker build` + Trivy (or equivalent) scan steps to `.github/workflows/ci.yml`, gated on the existing test steps passing | `.github/workflows/ci.yml` | none | 0.5d |
| 2 | Verify the scan step actually fails the workflow on a deliberately-introduced vulnerable base image or dependency (smoke-test the gate itself, then revert the smoke-test change) | `.github/workflows/ci.yml` (temporary) | Task 1 | 0.25d |

Total: ~0.75 days.

## 8. Data & migration impact

None.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Adding an image scan step introduces noisy false positives that block unrelated PRs | Medium | Medium | Start with `HIGH`/`CRITICAL` severity threshold only (not `MEDIUM`/`LOW`), matching common practice for a first rollout; tighten later once the team has triaged an initial baseline. |
| Docker image build meaningfully increases CI run time | Low | Low | The multi-stage `Dockerfile` already reuses a `dependencies` layer; CI's own `pnpm install` step already primes most of what the image build needs, and Docker layer caching (`actions/cache` or `docker/build-push-action`'s built-in cache) can be added if run time becomes a measured problem — not pre-optimized speculatively here. |

## 10. Test strategy

No unit/integration tests apply — this is a CI configuration change. Verification is Task 2 in Section 7: a deliberate smoke test proving the gate actually fails on a real finding, not just "the step ran and reported green because nothing was checked."

## 11. Rollout & rollback

Additive CI change — existing steps are untouched, new steps appended. Rollback is reverting the workflow file edit; no application code, schema, or runtime behavior is touched.

## 12. Open questions

- Should the built image eventually be pushed to a registry (ECR, per the target topology in `SYSTEM_DESIGN.md`) as part of this same ticket, or is that correctly deferred to whenever real cloud deployment is set up? This plan assumes the latter (Section 2, Section 6) since no registry/credentials exist in this repo today — flagging in case the product owner wants to pull that forward.
