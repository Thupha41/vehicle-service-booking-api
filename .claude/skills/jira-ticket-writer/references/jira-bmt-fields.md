# Jira BMT — field reference

Concrete values for the `booking-multitenant.atlassian.net` site and project `BMT`.
Read this when you are about to call the Atlassian MCP tools; it saves a round trip
of discovery calls. Re-verify anything that fails — Jira config drifts.

## Site

| | |
| --- | --- |
| Site | `booking-multitenant.atlassian.net` |
| `cloudId` | `78fb2821-a920-4f3b-b406-31824e639025` |
| Project key | `BMT` — "Booking Multitenant", team-managed (next-gen), software |
| Board | `2` |

The MCP server usually accepts the hostname in place of the UUID; if a call rejects it,
fall back to `getAccessibleAtlassianResources`.

## Issue types

| Name | id | Hierarchy |
| --- | --- | --- |
| Epic | `10006` | 1 |
| Task | `10008` | 0 |
| Story | `10009` | 0 |
| Feature | `10010` | 0 |
| Bug | `10011` | 0 |
| Subtask | `10007` | −1 |

Convention in this backlog: **Epic** for a capability group, **Story** for user-facing
behaviour, **Task** for platform/infra/documentation work.

## Fields that exist

| Field | Key | Notes |
| --- | --- | --- |
| Summary | `summary` | Required |
| Description | `description` | Markdown accepted (`contentFormat: "markdown"`, the default) |
| Assignee | `assignee_account_id` | Parameter on `createJiraIssue`, not inside `additional_fields` |
| Parent (epic link) | `parent` | Pass the epic key, e.g. `BMT-90` |
| Labels | `labels` | Array of strings |
| Priority | `priority` | `{"name": "Highest"}` — works even though it is absent from create-meta |
| Sprint | `customfield_10020` | Settable, but only with an **existing** sprint id |
| Start date | `customfield_10015` | `YYYY-MM-DD` |
| Due date | `duedate` | `YYYY-MM-DD` |
| Team | `customfield_10001` | Unused so far |
| Flagged | `customfield_10021` | `Impediment` |

## Fields that do NOT exist

- **Story Points.** Encode size as a label instead: `size-s`, `size-m`, `size-l`
  (roughly ≤3 days / 1–2 weeks / 3+ weeks).
- **Components.** The project has none; use labels.

## Transitions

| Target status | Transition id |
| --- | --- |
| To Do | `11` |
| In Progress | `21` |
| In Review | `31` |
| Done | `41` |

All are global and unconditional, so any status can move to any other.

## Label vocabulary

| Group | Labels |
| --- | --- |
| Programme | `brd-v3` on everything derived from the BRD |
| Epic | `ten`, `ctz`, `bkg`, `pay`, `fhir`, `doh`, `sec`, `rpt`, `nfr`, `gov` |
| Priority | `p0`, `p1`, `p2` (mirrors the Priority field so JQL stays simple) |
| Size | `size-s`, `size-m`, `size-l` |
| Sprint | `sprint-02`, `sprint-03`, … as a fallback when the Sprint field cannot be set |

## Sprints — the gap

The Atlassian MCP server exposes no Agile API: there is **no tool that creates a sprint**,
and `fetch` only resolves ARIs, so it cannot call `/rest/agile/1.0/sprint` either.

What this means in practice:

- You can put an issue into a sprint that already exists by setting `customfield_10020`
  to its numeric id.
- You cannot create the sprint. Ask the person to create it on board 2, then read the id
  back from any issue already in it (`sprint is not EMPTY` in JQL returns the sprint object
  with `id`, `name`, `state`, `boardId`).
- Until the sprint exists, tag issues with a `sprint-NN` label plus start/due dates so they
  can be filtered and moved in bulk with three clicks.

Say this plainly rather than silently skipping the sprint — a backlog that looks planned
but has no sprint is worse than an obviously unplanned one.

## Reading issues without blowing up context

`searchJiraIssuesUsingJql` returns full descriptions, and BMT descriptions are long — a
100-issue query is roughly half a million characters and will be spilled to a file.

- For counts and status sweeps, keep `maxResults` small, or accept the spill and parse the
  saved file with a script rather than reading it.
- The `fields` parameter does not reliably trim `description`; do not rely on it.
- `searchResultMode: "count"` is the cheap way to get a total.

## Known state of the backlog (2026-08-24)

86 pre-existing issues (12 Epic, 39 Task, 25 Story, 10 Subtask) generated from
`docs/migration/tasks/` with prefixes `PLT / DAT / BE / EXT / FE / CF / OPS / NET / QA / CUT`,
plus the BRD-derived epics added later (`BMT-90` TEN, `BMT-94` CTZ, …).

Before creating anything, check whether a task already exists under those prefixes. When it
does, comment a cross-reference on the existing issue instead of creating a duplicate — a
split backlog is much harder to repair than a missing ticket.
