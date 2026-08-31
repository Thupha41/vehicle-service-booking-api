# KAN-14 — Rate Limiting / Request Throttling

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-14
- **Type / Status / Priority:** Story / To Do / High
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

KAN-14 was written as a fresh-start ticket ("without a rate limit, one caller can exhaust database connections or degrade latency for everyone"). The real repo already has rate limiting implemented. Grounding this against the actual code — done in the same session as KAN-16, whose implementation directly touches the same file — finds the feature substantially complete, with one small remaining gap and one documentation gap, not a greenfield build.

## 2. Scope

### In scope

- Verify KAN-14's three acceptance criteria against `src/shared/http/rate-limit.ts` as it exists **after** KAN-16's fix (KAN-16 changed this file's response envelope — see Section 4).
- Add the one piece of test coverage that doesn't already exist: a test asserting the 429 response shape, the `Retry-After` header, and that requests under the limit are never throttled.
- Document the per-instance vs. global limiter-state choice explicitly, since the ticket's AC requires that be a stated deliberate choice, not an implicit default.

### Explicitly out of scope

- Moving from per-IP to per-identity limiting — KAN-14's own dependency note already defers this to the authentication & authorization strategy decision (KAN-6), which is unresolved.
- A WAF or DDoS mitigation layer (KAN-14 marks this out of scope explicitly).
- Any further change to the response envelope — KAN-16 already unified this file's error shape with the rest of the API via the shared `buildErrorBody` helper; re-touching it here would conflict with that work.

## 3. Assumptions

- "Per-IP limiting now" (per KAN-14's own text) means the current default IP-keyed limiting from `express-rate-limit` is acceptable until KAN-6 lands, not a defect to fix in this ticket.
- A single documented code comment stating "limiter state is per-instance (in-memory), not shared across horizontally-scaled instances" satisfies the AC's requirement for the choice to be "deliberate, not an accident of the default implementation" — the ticket does not require an actual distributed store (e.g. Redis) to be built, only that the current behavior be a stated choice.

## 4. Current behaviour

`src/shared/http/rate-limit.ts` (27 lines, post-KAN-16) implements `createRateLimitMiddleware(config)` using `express-rate-limit@8.6.2` (confirmed in `package.json`), mounted as raw Express middleware in `src/main.ts:41` before Nest's own request handling.

- **Configurable window/limit:** `windowMs`/`limit` read from `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`, validated as bounded integers in `src/shared/config/environment.ts:116-123` (window: 1s-1h, max: 1-100,000), with CI overriding both to permissive values (`RATE_LIMIT_WINDOW_MS: 60000`, `RATE_LIMIT_MAX: 1000` in `.github/workflows/ci.yml:36-37`) so tests aren't throttled.
- **429 response shape — fixed by KAN-16, not by this ticket:** as of KAN-16's implementation, the `handler` option (lines 13-24) builds the 429 body via the same `buildErrorBody()` helper the global exception filter uses (`src/shared/http/error-body.ts`), so the response now has `statusCode`, `error.code: 'RATE_LIMIT_EXCEEDED'`, `error.message`, `requestId`, `traceId` when present, `timestamp`, and `path` — the same envelope as every other error in the API. Before KAN-16, this was a real, separately-shaped gap (a Codex adversarial review confirmed it — see `docs/migration/plans/KAN-16/KAN-16-implementation-plan.md`, Appendix F1.2); it no longer needs work here.
- **`Retry-After` header — already present, verified against the installed library source.** `node_modules/.pnpm/express-rate-limit@8.6.2.../dist/index.cjs:303` calls `response.setHeader("Retry-After", resetSeconds.toString())` whenever a request is rejected, independent of the `standardHeaders`/`legacyHeaders` config. This directly satisfies the "429 with a `Retry-After` header" acceptance criterion — I initially expected this to need verification and confirmed it by reading the installed package's compiled source, not by assuming from the config options alone.
- **`standardHeaders: 'draft-8'`** additionally emits IETF-draft `RateLimit`/`RateLimit-Policy` headers, which `src/shared/http/cors.ts:18` already exposes cross-origin (`exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy']`) — so a browser client can read the rate-limit headers, not just receive them.
- **Limiter store:** no `store` option is passed to `rateLimit(...)`, so `express-rate-limit` defaults to its in-memory `MemoryStore` — state is per-instance, not shared across horizontally-scaled replicas. This is a real, working default, but the code contains no comment or documentation stating it's a deliberate choice rather than an oversight — that's the ticket's one real documentation gap.
- **No test coverage exists.** A search of `test/**` for `rate-limit`, `429`, or `RATE_LIMIT` returns no matches. Neither the 429 shape, the `Retry-After` header, nor "normal traffic isn't throttled" is covered by any test today.

## 5. Proposed approach

Two small pieces of work, no further production-code redesign:

1. **Document the limiter-store choice.** Add a short code comment directly above the `rateLimit({...})` call in `rate-limit.ts` stating that no `store` is configured, so state is per-instance/in-memory by design, with a one-line note on the upgrade path (a shared store such as `rate-limit-redis`) if horizontal scaling later makes per-instance limits ineffective. This satisfies the AC's "deliberate choice, not an accident" requirement without any behavior change.
2. **Add the missing test.** A focused integration test that: (a) sends requests under the configured limit and asserts none are throttled; (b) drives the request count past the limit and asserts the resulting response has `statusCode: 429`, `error.code: 'RATE_LIMIT_EXCEEDED'`, a `Retry-After` header, and the same `requestId`/`timestamp`/`path` shape as other errors. Coordinate file/location with KAN-16's own Task 5 (`test/integration/shared/http/rate-limit.spec.ts`, per its plan) — **do not create a second, competing test file**; if KAN-16's test task lands first, this ticket's remaining work is just the documentation comment plus reviewing that KAN-16's test already covers the "normal traffic isn't throttled" and `Retry-After` cases, adding only what's missing.

## 6. Alternatives considered and rejected

**Add a distributed store (Redis) now** — rejected for this ticket. KAN-14's own text says "per-IP limiting now; per-identity once the auth-strategy decision lands," which implies the current single-instance-oriented design is accepted as an interim state. Nothing in the current deployment (`compose.yaml`, `Dockerfile`) runs multiple API instances yet, so a distributed store would be speculative infrastructure with no current consumer — YAGNI. Revisit when horizontal scaling is actually deployed.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add deliberate-choice comment above the `rateLimit(...)` call | `src/shared/http/rate-limit.ts` | none | 0.1d |
| 2 | Coordinate with KAN-16 Task 5's rate-limit test; add only what's missing (429 shape, `Retry-After`, under-limit-not-throttled) | `test/integration/shared/http/rate-limit.spec.ts` (shared with KAN-16) | KAN-16 Task 3 (rate-limit fix, already done) | 0.25d |

Total: ~0.35 days. No new production behavior — a comment and a test.

## 8. Data & migration impact

None.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| This ticket's test task and KAN-16's Task 5 both try to create the same file, causing a conflict | Medium | Low | Whoever picks up KAN-14 checks `test/integration/shared/http/rate-limit.spec.ts` for existence first; if KAN-16's agent already created it, extend it rather than overwrite. |
| A future horizontal-scaling change silently relies on the current per-instance limiter without revisiting the comment left in Task 1 | Low | Low | The comment explicitly names the upgrade trigger (multiple instances) so it surfaces in code review of that future change. |

## 10. Test strategy

One integration test file (shared with KAN-16, see Section 7) covering: requests under the limit pass through untouched; a request that trips the limit gets `429` with the full standard error envelope and a `Retry-After` header present and parseable as a number of seconds.

## 11. Rollout & rollback

Trivial: a comment addition and a new test file. No behavior change beyond what KAN-16 already shipped. Rollback is a plain revert.

## 12. Open questions

- None blocking. The only coordination point is the shared test file with KAN-16, called out in Sections 5, 7, and 9.
