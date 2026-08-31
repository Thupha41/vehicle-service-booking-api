# KAN-6 — Authentication & Authorization Strategy Decision

- **Jira:** https://phatngo040103.atlassian.net/browse/KAN-6
- **Type / Status / Priority:** Story / To Do / Highest
- **Round:** 1 (verify-only reads confirmed the gap is real; decision is drafted here, not yet debated)

## 1. Problem

Every mutation endpoint in this API is currently public — `POST /v1/appointments`, `POST /v1/appointments/:id/cancel`, and (pending KAN-4) any future resource-administration endpoint all accept unauthenticated requests. `README.md` states this is intentional for the current assessment scope but that "production deployment must add OIDC authorization and controlled administrative workflows." This ticket is genuinely unimplemented — unlike most of this backlog, grounding it in the codebase confirms there is no auth code at all, not a hidden existing feature. It is also the blocking dependency named by KAN-4 and (loosely) KAN-14.

This ticket is a decision, not an implementation — but a decision without a concrete recommendation is not useful to whoever implements it next, so this plan proposes one specific answer rather than leaving the comparison open-ended.

## 2. Scope

### In scope

- Decide: identity provider, token format, validation point, authorization model (specifically dealership-scoping), token lifetime.
- Produce an ADR recording the decision and rationale.
- Define the concrete contract (claim names, header format, error codes) that KAN-4 and any future protected endpoint will implement against.

### Explicitly out of scope

- Standing up the identity provider itself (creating the actual Cognito user pool, configuring hosted UI, etc.) — infrastructure provisioning, not this repo's application code.
- Building any login/consent UI — this API has no UI layer (Swagger/cURL only, per `README.md`'s stated scope boundaries).
- Implementing the guard/middleware in code — that's KAN-4's and any future protected-endpoint ticket's job, once this decision exists to build against.

## 3. Assumptions

- The target production topology already documented in `docs/SYSTEM_DESIGN.md` ("Security and threat assumptions" section: "production design places OIDC/Cognito authentication at or before the API and uses dealership-scoped authorization for all reads and writes") is a real prior decision, not just placeholder text — this plan treats "OIDC, Cognito-shaped" as an already-narrowed starting point rather than re-opening the full identity-provider market.
- This service is a single deployable modular monolith (per ADR-0001) with no other internal services calling it — service-to-service auth is genuinely not needed yet, so this plan explicitly defers it rather than designing for a hypothetical future split.
- The API has no server-rendered pages and no first-party frontend in this repo (`README.md`: "uses Swagger/cURL as the client") — so this decision is scoped to bearer-token API authentication, not a browser session/cookie flow.

## 4. Current behaviour

Confirmed by reading the code, not assumed:

- No authentication guard, middleware, or decorator exists anywhere in `src/` (no `@UseGuards`, no `passport`, no `jsonwebtoken`/`jwks` dependency in `package.json`).
- `src/main.ts` wires `helmet()`, CORS, rate-limiting, validation, and Swagger (lines 39-43) — no auth step in that bootstrap sequence.
- `src/modules/appointments/appointments.controller.ts` has no route-level authorization; every one of its four endpoints is reachable by any caller who can reach the network.
- `docs/SYSTEM_DESIGN.md`'s threat-model table already names the intended production mitigation for "Cross-customer or cross-dealership association": "Tenant claims and authorization policy on every query" — this is documented intent, not implemented behavior.

## 5. Proposed approach

**Decision: AWS Cognito (managed OIDC) as identity provider; the NestJS app validates JWT access tokens directly via JWKS, independent of where they were issued or which edge component (ALB, direct) forwarded the request.**

| Question | Decision | Why |
| --- | --- | --- |
| Identity provider | AWS Cognito (managed OIDC) | Matches the already-documented target topology (`SYSTEM_DESIGN.md`'s AWS ECS/RDS/Cognito production architecture) — this isn't picking a new vendor, it's implementing what the architecture doc already named. |
| Token format | JWT access token (OIDC-compliant, RS256-signed) | Cognito issues JWTs natively; RS256 (asymmetric) lets the API verify signatures using Cognito's public JWKS endpoint without holding a shared secret. |
| Validation point | Inside the NestJS app (a `passport-jwt` strategy backed by `jwks-rsa` fetching Cognito's public keys), not offloaded to the ALB's native Cognito-auth listener action | The ALB-native approach (`authenticate-cognito` listener rule) works only when every caller goes through that specific ALB with browser-redirect login — it doesn't fit a token-bearing API client (cURL, a future frontend calling the API directly, service-to-service calls), and it would make the app's auth behavior invisible/untestable outside a real AWS deployment. In-app JWT validation is portable: it works identically locally, in CI, and in production, and is the pattern NestJS's own documentation recommends for API auth. |
| Authorization model | Claim-based, dealership-scoped: every protected mutation checks a `dealership_id` custom claim on the validated token against the `dealershipId` on the resource/request body being acted on | Directly implements the gap `SYSTEM_DESIGN.md` already named ("Tenant claims and authorization policy on every query"). Role-based alone (e.g. "is an admin") is insufficient here — the real risk this repo's own docs flag is cross-dealership data leakage, not just "authenticated vs not." |
| Service-to-service auth | Deferred, not designed now | No second service exists yet (single modular monolith, ADR-0001); designing a service-to-service auth scheme with no consumer would be speculative. Revisit only if/when a service boundary is actually extracted. |
| Token lifetime | Short-lived access token (Cognito default: 1 hour) + refresh token, standard OAuth2 flow, no session state held by this API | Matches the architecture's existing "stateless API" principle (`SYSTEM_DESIGN.md`: "The API is stateless... scale ECS tasks horizontally") — no server-side session store to keep consistent across horizontally-scaled instances. |

**The concrete contract KAN-4 (and any future protected endpoint) implements against:**
- `Authorization: Bearer <JWT>` header on every protected request.
- Missing/invalid/expired token → `401` with `error.code: 'UNAUTHENTICATED'`, using the same response envelope `GlobalExceptionFilter`/`buildErrorBody` already produces for every other error (see KAN-16's plan) — auth errors should not introduce a third, different error shape.
- Valid token but `dealership_id` claim doesn't match the resource's dealership → `403` with `error.code: 'DEALERSHIP_SCOPE_VIOLATION'`, same envelope.
- The guard is a standard Nest `@UseGuards(JwtAuthGuard)` (route-level), not a global guard — this repo's read endpoints (`GET /v1/appointments/:id`, `POST /v1/availability/check`) are explicitly out of this ticket's scope to protect; only mutation/administrative endpoints need it, decided per-route by whoever adds them, not forced globally by this decision.

## 6. Alternatives considered and rejected

**ALB-native Cognito authentication (`authenticate-cognito` listener action)** — rejected as the primary mechanism (see table above): it couples correct auth behavior to a specific AWS deployment topology, breaking local development and CI testing of authorization logic, and doesn't naturally fit non-browser API clients. It remains a *reasonable optional layer* in front of the ALB for a future browser-based admin UI, but the API's own authorization logic must not depend on it being present.

**Self-hosted Keycloak instead of Cognito** — rejected. This repo's target production topology (`SYSTEM_DESIGN.md`) already commits to AWS-managed services (RDS, ECS, Secrets Manager); adding a self-hosted identity provider would mean operating a new stateful service with its own HA/backup/patching burden, contradicting the "reliability before throughput, few moving parts" principle the same doc states elsewhere. Cognito is already the named target.

**Opaque token + introspection endpoint instead of JWT** — rejected. Introspection adds a network round-trip (to the identity provider) on every authenticated request, which conflicts with this API's short-transaction, low-latency booking path design (ADR-0002's rejection of external calls on the critical path for the same reason). JWTs verified locally via cached JWKS keys add no such per-request network dependency.

## 7. Work breakdown

This ticket's own deliverable is the decision (Section 5) plus the ADR — no application code changes. Implementation work belongs to whichever ticket first needs a protected route (KAN-4).

| # | Task | Files | Depends on | Est. |
| --- | --- | --- | --- | --- |
| 1 | Write `docs/adr/0005-authentication-cognito-jwt.md` capturing Section 5's decision table and rationale, matching the format of existing ADRs (read `docs/adr/0001-modular-monolith.md` first) | `docs/adr/0005-authentication-cognito-jwt.md` (new) | none | 0.5d |
| 2 | Update KAN-4's plan/ticket to reference this decision's concrete contract (header format, error codes, claim name) instead of listing authentication as an open question | Jira KAN-4 (comment, on confirmation) + `docs/migration/plans/KAN-4/KAN-4-implementation-plan.md` | Task 1 | 0.25d |

Total: ~0.75 days. No production code in this ticket.

## 8. Data & migration impact

None directly — no schema change. (Implementing the guard, in a later ticket, will need to decide how `dealership_id` maps from a Cognito custom claim onto this app's existing `dealerships` table records; that mapping is KAN-4's concern, not this decision ticket's.)

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Cognito user pool provisioning (out of scope here) becomes a blocking dependency for KAN-4 with no owner | Medium | Medium | Flag explicitly in Section 12 below; this decision ticket recommends but doesn't provision — someone must pick up the infrastructure task before KAN-4's implementation can be tested end-to-end against a real pool (local/CI testing can still use a mocked JWKS endpoint). |
| Claim name (`dealership_id` vs `custom:dealership_id`, Cognito's convention for custom attributes) is finalized incorrectly here and has to change later | Low | Low | Section 5 names the intended semantic claim; the exact Cognito attribute name gets confirmed against the actual user-pool schema when it's provisioned, and the ADR should be updated then if it differs. |

## 10. Test strategy

Not applicable to this ticket directly (no code). The ADR should state the testability requirement for whoever implements the guard: local/CI tests must be able to run without a live Cognito pool, by mocking the JWKS endpoint or using a locally-generated RS256 key pair to sign test tokens — call this out explicitly in the ADR so KAN-4's implementation doesn't accidentally require live AWS credentials in CI.

## 11. Rollout & rollback

Documentation-only change (an ADR file). No rollout mechanics. Rollback is deleting/superseding the ADR if the decision changes later — ADRs are immutable historical records by convention, so a reversal should be a new ADR that supersedes this one, not an edit to it.

## 12. Open questions

- **Who provisions the actual Cognito user pool?** This is infrastructure work outside this repo's application code and outside this ticket's scope (Section 2) — needs an owner and is a real blocking dependency for KAN-4's end-to-end testing against a live provider, even though KAN-4's guard logic itself can be built and unit-tested against a mocked JWKS source without it.
- Should the `JwtAuthGuard` be applied per-route (this plan's recommendation, Section 5) or should a subset of routes use a global guard with explicit `@Public()` opt-outs for the two read endpoints? Either is workable; per-route was chosen here to keep the blast radius of this decision small (nothing changes for existing public endpoints until a ticket explicitly protects a new one), but a global-guard-with-opt-out pattern is also common in NestJS codebases and could be revisited if the number of protected routes grows large enough that per-route annotation becomes error-prone to audit.
