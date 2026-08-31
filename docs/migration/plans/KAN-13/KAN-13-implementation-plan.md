# KAN-13 — CORS Policy

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-13
- **Type / Status / Priority:** Story / To Do / High
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

The API needs an explicit cross-origin policy: an allowlist (no wildcard once any credential-bearing behavior is possible), explicitly scoped methods/headers, a sane preflight cache duration, and per-environment origin lists — not "block every browser client" and not "allow every origin by accident." The ticket was written fresh-start, but this repo already has a dedicated CORS configuration module wired into `main.ts`. This plan verifies it against the ticket's three acceptance criteria and checks specifically for the automated test the ticket's own "Evidence to attach" line asks for.

## 2. Scope

### In scope

- Verify the CORS configuration module against the ticket's allowlist, scoped-methods/headers, preflight-cache, and per-environment ACs.
- Search for and assess any existing automated test asserting a non-allowlisted origin receives no CORS headers (the ticket's specific evidence requirement).

### Explicitly out of scope

- The frontend's own origin/domain provisioning (the ticket's own "Out of scope").

## 3. Assumptions

- "Each environment has its own explicit origin list" (AC #3) is satisfied at the *code* level by driving the allowlist entirely from an environment variable (`CORS_ORIGINS`) rather than a hardcoded list — whether staging and production actually set *different* values for that variable is an operational/deployment-configuration matter this repo's code cannot force, only support. This plan treats that as a documented operational assumption, not a code gap, consistent with how the grounding notes framed it.
- `credentials: false` (no cookies/credentialed requests) means the "no wildcard `*` once credentials/cookies are involved" clause in the ticket's key considerations is moot for the current design — the code doesn't need to special-case credentialed requests because it never allows them, and it still uses an explicit allowlist (not `*`) regardless.

## 4. Current behaviour

Verified by reading the full current file, not solely from prior grounding notes:

- **`src/shared/http/cors.ts` (22 lines) implements an origin-allowlist callback, not a wildcard.** `configureCors()` calls `app.enableCors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) { callback(null, true); return; } callback(null, false); }, ... })` (lines 4-15) — a request from an origin not in `allowedOrigins` gets `callback(null, false)`, which tells the underlying `cors` middleware to omit `Access-Control-Allow-Origin` from the response entirely (not send `*`, not echo the origin back). `!origin` (no `Origin` header at all — same-origin or non-browser clients) is allowed through, which is standard CORS middleware behavior and does not weaken the allowlist for actual cross-origin browser requests.
- **Explicitly scoped methods and headers, not a blanket allow-all.** Lines 16-18: `methods: ['GET', 'POST', 'OPTIONS']`, `allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id']`, `exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy']` — a fixed, minimal set matching what this API's clients actually need (idempotency key, request correlation, rate-limit headers), not `methods: '*'`/`allowedHeaders: '*'`.
- **`credentials: false`** (line 19) — no cookie/credential-bearing cross-origin requests are permitted at all, which is the safest posture and sidesteps the wildcard-with-credentials footgun entirely.
- **Sane preflight cache.** `maxAge: 600` (line 20) — 10 minutes, a reasonable, explicit, non-default preflight cache duration.
- **Per-environment allowlist driven by an env var, not hardcoded.** `src/shared/config/environment.ts:104`: `CORS_ORIGINS: parseString(raw.CORS_ORIGINS, 'http://localhost:3000', 'CORS_ORIGINS')`, and `parseCorsOrigins()` (`environment.ts:127-132`) splits that string on commas, trims, and filters blanks into an array. `src/main.ts:40`: `configureCors(app, parseCorsOrigins(config.get<string>('CORS_ORIGINS')))` — the allowlist is entirely a function of the `CORS_ORIGINS` environment variable, so each deployed environment (local/staging/prod) can supply its own value via its own environment configuration (`compose.yaml:28` sets `CORS_ORIGINS: http://localhost:3000` for local Docker; `.github/workflows/ci.yml:32` sets the same for CI). No environment is hardwired to share another's list in code — the mechanism supports distinct per-environment lists; whether each real deployment target actually sets a distinct value is an operational choice outside this repo's code.
- **Wired before the app accepts real traffic.** `src/main.ts`: `express.use(helmet())` (line 39) then `configureCors(app, parseCorsOrigins(...))` (line 40), both during bootstrap before `app.listen()`.

**Gap found (test coverage):** a search of `test/` for any file referencing `cors` or `CORS_ORIGINS` (case-insensitive) returned **no matches**. There is no automated test anywhere in the suite asserting that a non-allowlisted origin receives a response without CORS headers, or asserting the allowlisted-origin/methods/headers behavior at all. This is exactly the gap the ticket's own "Evidence to attach" line calls out: *"Automated test asserting a non-allowlisted origin receives no CORS headers"* — the code satisfies the three functional ACs, but the specific evidence the ticket asks for does not exist yet. This mirrors the KAN-16 pattern precisely: implementation done, test coverage missing.

## 5. Proposed approach

**Done-with-one-gap.** All three acceptance criteria are satisfied by the existing `configureCors()`/`parseCorsOrigins()` implementation: allowlist-based origin checking (not wildcard), explicitly scoped methods/headers, and a per-environment-configurable origin list via `CORS_ORIGINS`. No production code change is needed.

The one gap is test coverage, matching the ticket's own evidence requirement exactly: add a supertest-level test that boots the app (reusing the existing `createApiTestApp()`/similar test-app helper already used by `test/concurrency/booking.concurrency.spec.ts` and other suites) with a known `CORS_ORIGINS` value, sends a request with an `Origin` header **not** in that list, and asserts the response has no `Access-Control-Allow-Origin` header (and, for completeness, a second case asserting an allowlisted origin **does** get the header with the expected scoped methods/headers echoed on a preflight `OPTIONS` request).

## 6. Alternatives considered and rejected

- **Claim AC #3 (per-environment lists) is fully satisfied without qualification.** Rejected — the code supports distinct per-environment lists but cannot force staging and production to actually use different values; that's outside application code's control. This plan states the code-level support plainly and flags the "each deployment must actually set a distinct value" part as an operational assumption rather than silently treating it as proven.
- **Skip the test and call the ticket done purely on code inspection.** Rejected — the ticket explicitly names the missing evidence ("Automated test asserting a non-allowlisted origin receives no CORS headers"); the same standard KAN-16 was held to (test-only gap called out and closed) applies here.
- **Write only a unit test around the `origin` callback function in isolation** (extract and call it directly with mock `callback`). Considered as a lighter-weight option, but rejected as the primary approach — a unit test of the raw callback wouldn't prove the full `cors`/Nest middleware pipeline actually omits the header on the wire, which is what the ticket's evidence line is asking for ("the browser blocks it due to missing CORS headers" — an HTTP-response-shape claim, not a function-return-value claim). An HTTP-level test is the right level of evidence here, mirroring KAN-16's own reasoning for preferring behavior-level assertions.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Add a CORS test file: non-allowlisted origin gets no `Access-Control-Allow-Origin` header; allowlisted origin gets the header plus the expected scoped `methods`/`allowedHeaders` on a preflight `OPTIONS` request | `test/integration/shared/http/cors.spec.ts` (new) — location to match this repo's existing integration-test conventions (mirroring the KAN-16 plan's placement choice for its own middleware-level test) | none | 0.5d |

Total: ~0.5 day. No production code change; one new test file.

## 8. Data & migration impact

None. No schema, entity, or migration touched.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Test hardcodes a `CORS_ORIGINS` value that drifts from whatever the real test-app bootstrap helper already sets, producing a false pass/fail | Low | Low | Read the existing test-app helper's environment setup first and either reuse its configured origin or explicitly override `CORS_ORIGINS` for this test's app instance, asserting against the value actually used. |
| A future change to `cors.ts`'s scoped `methods`/`allowedHeaders` list silently narrows what real clients need, with no test catching it | Low | Low | The new test's allowlisted-origin case asserts the exact current `methods`/`allowedHeaders` values, turning any future narrowing into a visible, intentional test update rather than a silent behavior change. |

## 10. Test strategy

- **Integration-level** (HTTP requests against a bootstrapped app, real `cors` middleware in the pipeline — no need for a database): the two cases from Section 7.
- Failure case covered: a request from an origin not in `CORS_ORIGINS` receives a response with no `Access-Control-Allow-Origin` header (the browser then blocks the response client-side, which is the actual security property AC #1 describes — the test asserts the header's absence, which is what causes that browser behavior).
- Success case covered: a request from an allowlisted origin receives `Access-Control-Allow-Origin` matching that origin, and a preflight `OPTIONS` request receives the exact configured `methods`/`allowedHeaders`, not a broadened set.

## 11. Rollout & rollback

Purely additive: one new test file, no production code touched, gated by the existing CI pipeline. No feature flag needed. Rollback is a plain revert of the test file if it turns out to be flaky or wrong.

## 12. Open questions

- Do staging and production (once those environments are actually stood up) each set a distinct `CORS_ORIGINS` value, or could they end up sharing the local default (`http://localhost:3000`) by omission? This repo's code supports per-environment lists but cannot enforce that operators actually populate them distinctly — flagging for whoever owns deployment configuration, not resolvable from source alone.
