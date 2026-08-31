# KAN-15 — Security Headers & Baseline Hardening

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-15
- **Type / Status / Priority:** Story / To Do / High (Size XS)
- **Round:** 1 (verify-only, no adversarial review run)

## 1. Problem

Standard HTTP security headers close a class of low-effort, high-value gaps (clickjacking, MIME sniffing, missing HSTS) before any custom security work is needed. The ticket was written as a fresh-start backlog item ("no headers exist yet"), but this codebase already mounts `helmet()` globally (`src/main.ts:39`). This plan grounds the ticket's three acceptance criteria against that real code and the installed `helmet` version's documented defaults, rather than assuming they're satisfied.

## 2. Scope

### In scope

- Verify the three KAN-15 acceptance criteria against `helmet@8.3.0`'s actual documented defaults (not assumed behavior).
- Investigate the ticket's specific CSP concern — whether the default Content-Security-Policy is "copy-pasted from a page-serving app" and meaningless for this API, or genuinely applicable — with a reasoned verdict, not a reflexive answer.
- Close the one small, real deviation found between the ticket's literal wording ("frame-ancestors denied") and helmet's actual default (`frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`).
- Add the missing "Evidence to attach" artifact: a response header snapshot test.

### Explicitly out of scope

- CSP for a page-serving frontend, if one exists separately (ticket marks this out of scope explicitly).
- Rewriting the CSP into a hand-maintained directive list — helmet's own defaults already scope correctly once `frame-ancestors` is tightened (Section 4).

## 3. Assumptions

- "Frame-ancestors denied" (AC1) is read as requiring `'none'`, not merely same-origin framing permitted — this API has no legitimate reason to frame itself, so `'self'` (the shipped default) is a real, if minor, gap against the AC's literal wording.
- "HSTS in non-local environments" (AC1) is satisfied by an *unconditional* HSTS header (helmet's default sends it in every environment) — this is a superset of "non-local environments," not a violation, since HSTS received over plain HTTP in local dev is inert (browsers only act on it after first seeing it over HTTPS).

## 4. Current behaviour

`src/main.ts:39` mounts `express.use(helmet())` with zero custom options, as raw Express middleware applied globally before Nest's own request handling — it runs on every response, including `/docs` (Swagger UI) and every `/v1/*` JSON route. `package.json:51` pins `"helmet": "^8.3.0"`; the installed version is confirmed as `8.3.0` (`node_modules/helmet/package.json:4`).

Per `helmet@8.3.0`'s documented defaults (`node_modules/helmet/README.md`), `helmet()` with no arguments sets 13 headers, including:

- **`Strict-Transport-Security: max-age=31536000; includeSubDomains`** (README:379) — satisfies AC1's HSTS requirement, unconditionally.
- **`X-Content-Type-Options: nosniff`** (README:448) — satisfies AC1 exactly.
- **`X-Frame-Options: SAMEORIGIN`** (README:562) plus CSP's **`frame-ancestors 'self'`** (README:61) — blocks cross-origin framing but still permits same-origin framing. AC1's literal wording ("frame-ancestors denied") calls for `'none'`/`DENY`, not `'self'`/`SAMEORIGIN` — this is the one real, minor deviation found (see Section 5).
- **`X-Powered-By` removed** (README:663) — satisfies AC2 exactly.
- **Content-Security-Policy** defaults (README:56-66): `default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests`.

**CSP investigation (AC3).** The ticket's key consideration warns against a CSP "copy-pasted from a page-serving app" for an API with no server-rendered HTML. This app is *not* purely headless JSON, however: `configureSwagger()` (`src/shared/http/swagger.ts:26`) mounts an interactive Swagger UI at `/docs`, which is real server-rendered HTML with real script/style needs — and the blanket `helmet()` call at `main.ts:39` covers that route too. Verified against `@nestjs/swagger`'s bundled HTML template (`node_modules/.pnpm/@nestjs+swagger@11.4.7.../dist/swagger-ui/constants.js:74-76`): the UI loads `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js`, and `swagger-ui-init.js` as same-origin external `<script src="...">` tags — **no inline scripts** anywhere in the template. The only inline content is a `<style>` block (`constants.js:15-33, 80-83`), which the default policy's `style-src 'self' https: 'unsafe-inline'` already permits. **Verdict: the default CSP is not meaningless or copy-pasted noise — it's a genuinely working, same-origin-scoped policy for the one real HTML surface this app serves, and it is inert (present but functionally unenforced) on the pure-JSON `/v1/*` routes, which carry no security downside.** No CSP rewrite is warranted.

**Gap found (evidence/test coverage).** No header-snapshot test exists — confirmed by grep across `test/**` for helmet/CSP/HSTS/X-Frame-Options/X-Powered-By: no matches. KAN-15's "Evidence to attach" line (a response header snapshot test) is currently unmet.

## 5. Proposed approach

Mostly DONE. Two of three ACs (HSTS + nosniff, and `X-Powered-By` removal) are fully satisfied by the zero-config `helmet()` call today. The CSP AC is satisfied in a reasoned, verified way (Section 4), not accidentally. One small, worthwhile tightening remains: explicitly set `frameguard: { action: 'deny' }` and override the CSP's `frame-ancestors` directive to `'none'`, since neither `/docs` nor any `/v1/*` route has a legitimate same-origin-framing use case. This closes the textual gap between the ticket's "frame-ancestors denied" wording and the shipped default's `SAMEORIGIN`/`'self'`. Then add the missing header-snapshot test so this behavior is regression-covered.

## 6. Alternatives considered and rejected

- **Rewrite the whole CSP down to `default-src 'none'` with a hand-picked directive list for Swagger's needs.** Rejected — this duplicates helmet's own default directive set (already same-origin-scoped) with bespoke knowledge of `swagger-ui-dist`'s asset needs, adding maintenance burden without closing any AC gap the `frame-ancestors` tweak doesn't already close.
- **Leave `frame-ancestors` at the default `'self'`/`SAMEORIGIN`.** Rejected — a one-line change, and `'self'` has no legitimate use case here (nothing in this app frames itself), so `'none'`/`DENY` is strictly more correct and directly answers the ticket's literal wording.

## 7. Work breakdown

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Override CSP `frame-ancestors` to `'none'` and `frameguard` action to `'deny'` in the `helmet()` call | `src/main.ts` | none | 0.25d |
| 2 | Add a header-snapshot e2e test asserting HSTS, `nosniff`, `frame-ancestors 'none'`/`X-Frame-Options: DENY`, `X-Powered-By` absent, and CSP presence on both a `/v1/*` JSON route and `/docs` | `test/e2e/security-headers.e2e.spec.ts` (new) | Task 1 | 0.5d |
| 3 | Run `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck` | n/a | Tasks 1-2 | 0.25d (buffer) |

Total: ~1 day. One 3-line config change, one new test file.

## 8. Data & migration impact

None. No schema, entity, or migration touched.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Tightening `frame-ancestors`/`X-Frame-Options` to `DENY` breaks an undocumented same-origin iframe embed of `/docs` some future consumer relies on | Low | Low | Nothing in the current README or tests embeds `/docs` in a frame; `DENY` is the ticket's own literal wording. |
| The global `helmet()` CSP is loosened later (e.g. if an actual page-serving frontend is added to this API) without review | Low | Medium | The new header-snapshot test asserts specific directive values, so an accidental change to `main.ts`'s helmet config fails CI. |
| Header test becomes brittle across a future `helmet` major-version upgrade | Low | Low | Assert on documented header *values* (behavioral), not on library internals, so the test stays valid across helmet minor/patch upgrades. |

## 10. Test strategy

- **e2e only** (`pnpm test:e2e`): boot the real app the same way `main.ts` does, request a `/v1/*` JSON route and `/docs`, and assert each header's exact value. Headers are pure response-level cross-cutting behavior, not business logic, so end-to-end coverage against the real Express pipeline is more meaningful here than a unit test around `helmet()` in isolation.
- No new unit test needed — nothing in `main.ts`'s bootstrap sequence is presently unit-testable without a full app boot.

## 11. Rollout & rollback

Trivial, low-risk change: a 3-line config tightening plus one new test file, gated by the existing CI pipeline (lint, typecheck, e2e). No feature flag needed — the change only narrows an already-permitted-but-unused same-origin framing allowance. Rollback is a plain revert of the commit; no schema, data, or configuration is touched.

## 12. Open questions

- Should HSTS's `preload` flag be enabled once this service sits behind a load balancer that terminates TLS domain-wide? Not required by KAN-15's ACs (which only ask for HSTS presence in non-local environments); flagged for a future infra-owner decision since HSTS preload is effectively irreversible once submitted to browser preload lists.
- The ticket's "HSTS once TLS is enforced" key consideration implies conditioning HSTS on environment/TLS state; the current implementation sends it unconditionally, including over local plain HTTP. This is harmless but if a future reviewer wants strict environment-gating to match that prose exactly (rather than the AC's literal, already-satisfied text), that would be an additional small `main.ts` change gated on `NODE_ENV`.
