# KAN-19 — Containerization & Local Development Environment

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-19
- **Type / Status / Priority:** Story / To Do / Medium (Size S)
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

A new contributor should be able to get the full stack running with one command, and that same container definition should be the basis for how the service actually deploys. The ticket was written as a fresh-start backlog item, but this codebase already has a multi-stage `Dockerfile` and a `compose.yaml` at the repo root. This plan verifies the ticket's three acceptance criteria against the actual `compose.yaml` service topology (dependency conditions, healthchecks), not just the README's prose describing it.

## 2. Scope

### In scope

- Verify `compose.yaml`'s service topology, healthcheck, and `depends_on` conditions actually enforce migrate-before-app ordering (AC2), not just as documented prose.
- Verify the host port mapping avoids colliding with a developer's default local Postgres (AC3).
- Verify whether the full flow is genuinely single-command (AC1) given the README shows seed as a separate manual step.
- Note the presence or absence of a local telemetry collector, since the ticket's key considerations name one explicitly.

### Explicitly out of scope

- Production orchestration (e.g. Kubernetes manifests) — the ticket marks this out of scope explicitly; this is local dev only.

## 3. Assumptions

- "No dependency on the host machine beyond the container runtime" is read as: at minimum, a fully containerized path to a running, migrated API must exist and not require host-installed `pnpm`/Node/Postgres. The README's separate "Clean setup from a clone" host-loop instructions (which do use `pnpm` on the host) are a developer convenience, not a violation of this AC, since the fully containerized `docker compose up -d --build` path exists as the AC-satisfying alternative.
- "Any local telemetry collector" in the ticket's key considerations is read as conditional ("any" = optional), not mandatory — `OTEL_ENABLED` defaults to `false` (`src/shared/config/environment.ts:105`) and `compose.yaml`'s `api` service explicitly sets `OTEL_ENABLED: 'false'` (`compose.yaml:29`), so no local telemetry data is produced by default that would need a collector.

## 4. Current behaviour

- **Dockerfile** (`Dockerfile:1-24`, reconfirmed): 3-stage build — `dependencies` (:1-5), `build` (:7-13), `runtime` (:15-24) — `USER node` (:22, non-root), `EXPOSE 3000` (:23), `CMD ["node", "dist/main.js"]` (:24).
- **`compose.yaml`** (`F:\Unified Service Scheduler\compose.yaml`, 58 lines) defines three services, verified line-by-line against the README's claims:
  - **`db`** (:2-17): `postgres:17-alpine`, healthcheck via `pg_isready -U scheduler -d scheduler` (:8-12), **host port `55432` mapped to container `5432`** (:13-14) — matches the README's collision-avoidance claim exactly.
  - **`migrate`** (:36-54): builds from the same Dockerfile context, runs `node node_modules/typeorm/cli.js migration:run -d dist/shared/database/data-source.js` as its `command` (:39-46), `depends_on: db: condition: service_healthy` (:51-53), `restart: 'no'` (:54) — a genuine one-shot job gated on the DB's healthcheck actually passing, not merely on the container having started.
  - **`api`** (:19-34): `depends_on: migrate: condition: service_completed_successfully` (:30-32) — Compose will not start the `api` container until the `migrate` container has exited `0`. **This is a real, verified ordering guarantee, not just README prose**: migrations cannot race the app's startup, and the app cannot accept traffic before migrations finish. Satisfies AC2 exactly.
- **No local telemetry-collector service** exists in `compose.yaml` — only `db`, `api`, `migrate`. Consistent with `OTEL_ENABLED: 'false'` being the explicit default for the `api` service (:29), but the ticket's key considerations list "any local telemetry collector" alongside app/database as part of "a single-command local stack" — so a developer who sets `OTEL_ENABLED=true` locally to exercise tracing has no Compose-managed OTLP collector to receive it; they'd need to run one separately. A real, minor absence relative to the ticket's full description (not against the three ACs individually, none of which mention telemetry).
- **`README.md`'s "Clean setup from a clone"** section (:24-40) documents a *non-containerized* host-loop path (`pnpm install`, `docker compose up -d db` for just the database, then host-run `pnpm migration:run` / `pnpm seed` / `pnpm start:dev`) — a dev-loop convenience path, separate from the containerized AC1 path.
- **`README.md`'s "For a fully containerized run"** section (:50-55) documents the actual AC1 path: `docker compose up -d --build` — genuinely single-command, starting `db` → `migrate` → `api` per the verified `compose.yaml` topology above. **A second, separate manual command follows**: `docker compose exec api node dist/shared/database/seed.js`, to apply demo seed data. Per AC1's literal wording ("when the documented single command is run, then the full local stack starts successfully") — "starts successfully" does not require seed data to be present, so the seed step being separate does **not** violate AC1 as written; it would only be a gap under a stricter "one command to a fully demo-ready state" reading, which is not what the AC says. Noting this honestly rather than silently treating "single command" as covering seeding too.
- **Port mapping** is documented precisely in `README.md:26` ("exposed on host port `55432` to avoid colliding with an existing PostgreSQL installation on `5432`"), matching `compose.yaml:13-14` exactly — satisfies AC3.

## 5. Proposed approach

DONE against all three literal acceptance criteria, verified via `compose.yaml`'s actual `depends_on`/healthcheck conditions rather than README prose alone — no code change is required to satisfy AC1-3. One optional addition is worth surfacing rather than forcing in: an `otel-collector` service to close the gap between the ticket's descriptive "any local telemetry collector" key consideration and what's actually in `compose.yaml` today. Since none of the three ACs require it and OTEL is off by default, this plan proposes it as a single small, profile-gated (opt-in) task rather than blocking the ticket on it — see Section 12 for the decision to hand back to the team.

## 6. Alternatives considered and rejected

- **Add a full production-grade observability stack (Prometheus, Grafana, Tempo, a collector) to `compose.yaml`.** Rejected — the ticket explicitly scopes to local dev only, and production orchestration is out of scope; a full stack duplicates what `/metrics` (already exposed, `README.md:143`) and an external OTLP backend already provide when needed.
- **Add only a bare-minimum `otel-collector` service with a debug/console exporter, gated behind a Compose profile so it never starts by default.** Preferred lightweight option if the team wants to close the key-consideration gap — described as an optional Work Breakdown task below.
- **Leave `compose.yaml` as-is.** Also reasonable, since no AC requires the collector; presented as the default recommendation, with the collector as an opt-in nice-to-have.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 (optional) | Add an `otel-collector` service to `compose.yaml`, gated behind a Compose `profiles: ["observability"]` tag so it never starts on a plain `docker compose up`, with a debug exporter, for developers who set `OTEL_ENABLED=true` locally | `compose.yaml` | none | 0.5d |
| 2 | Update the README's containerized-run section to note the collector is opt-in (`docker compose --profile observability up -d --build`), only if Task 1 is taken | `README.md` | Task 1 | 0.1d |

Total: ~0.5-0.6 day if the optional collector is added; **0 days if not** — the ticket's literal ACs are already satisfied by the current `compose.yaml`.

## 8. Data & migration impact

None — the `migrate` service already runs the existing TypeORM `migration:run` command as a one-shot job; no new migrations needed.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Adding an `otel-collector` service increases `compose.yaml` complexity for a feature most local runs won't use (`OTEL_ENABLED` defaults `false`) | Low | Low | Gate it behind a Compose profile so it's fully inert unless explicitly requested. |
| README's two-command containerized flow (`up -d --build` + a separate `exec ... seed.js`) is later misread as an AC1 failure | Low | Low | This plan documents the distinction precisely (Section 4) so it's understood as "AC1 doesn't require seeding," not an oversight. |
| A `migrate` service failure (e.g. a bad migration) leaves `api` never starting, and a new contributor doesn't know why `docker compose up` appears stuck | Low | Low | Already covered by Compose's own `depends_on` failure semantics (the `migrate` container's exit code is visible via `docker compose ps`/`logs`); no code change proposed, just an awareness note for onboarding docs. |

## 10. Test strategy

No unit/integration/e2e test applies to Compose orchestration itself. The closest available verification is the ticket's own "clean-machine run" evidence line, satisfied procedurally: run `docker compose up -d --build` on a fresh clone, then `docker compose ps` to confirm `db` healthy, `migrate` exited `0`, and `api` running and passing `/health/live` and `/health/ready`. This plan proposes running that exact check once as the evidence artifact for this ticket, not as a new CI test (production orchestration/CI-level compose testing is out of scope per Section 2).

## 11. Rollout & rollback

If Task 1 (optional collector) is taken, it's purely additive (a new service most runs won't touch) — rollback is deleting the service block. If not taken, there is nothing to roll out; the ticket's ACs are already satisfied by code that predates this plan.

## 12. Open questions

- Does the team want the optional `otel-collector` service, given the ticket's key considerations mention one but none of the three acceptance criteria strictly require it? Two options: (a) add it now as a small, profile-gated addition (Section 7, Task 1), or (b) leave it and treat local OTEL tracing as "point it at an external/host-run collector when needed," which the app already supports via `OTEL_EXPORTER_OTLP_ENDPOINT`. Needs a decision.
- Should the README's containerized section be restructured so `docker compose up -d --build` also runs the seed automatically (e.g. a `seed` one-shot service similar to `migrate`, gated behind `restart: 'no'` and a healthy-`api` dependency), to make it a true single command including demo data? Not required by AC1 as worded, but would tighten the "single command" story further if the team wants strict one-command onboarding inclusive of seed data.
