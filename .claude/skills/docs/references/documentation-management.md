# Documentation Management Routing

Use this file when another skill needs to decide whether docs should be created
or updated. For full doc operations, use `/mk:docs init`, `/mk:docs update`, or
`/mk:docs summarize`.

## When To Update Docs

Update docs only when the change affects:

- user-visible behavior
- setup, install, or CLI commands
- architecture, data flow, or public contracts
- security posture or operational procedures
- future maintainer decisions that should not be rediscovered

Do not add documentation noise for purely internal edits unless the repo already
requires it.

## Common Docs

- `docs/project-overview-pdr.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/system-architecture.md`
- `docs/project-roadmap.md` or `docs/development-roadmap.md`
- `docs/project-changelog.md` when present

## Plan and Report Locations

Save plans under `plans/<timestamp>-<descriptive-slug>/`.

```text
plans/<slug>/
  plan.md
  phase-01-<name>.md
  reports/
  visuals/
```

Keep `plan.md` short: status, phases, dependencies, acceptance criteria, and
links to phase files. Put execution detail in phase files.

## Cross-Skill Handoffs

- `/implement`: update docs during finalization only when warranted by the
  criteria above.
- `/mk:plan`: read existing docs before creating architecture or phase plans.
- Keep architecture diagrams as small Mermaid blocks in the owning Markdown
  document unless the project explicitly needs a separate visual artifact.

Before updating a doc, read it first. After updating, verify dates, links, and
claims match the actual change.
