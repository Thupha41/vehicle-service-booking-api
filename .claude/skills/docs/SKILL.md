---
name: mk:docs
description: "Analyze codebase and manage project documentation. Use for doc initialization, updates, summaries, codebase analysis."
user-invocable: true
when_to_use: "Invoke to create, refresh, or audit project documentation."
category: utilities
keywords: [documentation, init, update, summarize]
argument-hint: "init|update|summarize"
metadata:
  author: my-kit
  version: "1.2.0"
---

# Documentation Management

Analyze codebase and manage project documentation through repository inspection, analysis, and structured doc generation.

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available documentation operations:

| Operation | Description |
|-----------|-------------|
| `init` | Analyze codebase & create initial docs |
| `update` | Analyze changes & update docs |
| `summarize` | Quick codebase summary |

Present as options via `AskUserQuestion` with header "Documentation Operation", question "What would you like to do?".

## Subcommands

| Subcommand | Reference | Purpose |
|------------|-----------|---------|
| `/mk:docs init` | `references/init-workflow.md` | Analyze codebase and create initial documentation |
| `/mk:docs update` | `references/update-workflow.md` | Analyze codebase and update existing documentation |
| `/mk:docs summarize` | `references/summarize-workflow.md` | Quick analysis and update of codebase summary |

When another workflow needs to decide whether docs should change, load
`references/documentation-management.md` before invoking a docs update.

## Routing

Parse `$ARGUMENTS` first word:
- `init` → Load `references/init-workflow.md`
- `update` → Load `references/update-workflow.md`
- `summarize` → Load `references/summarize-workflow.md`
- empty/unclear → AskUserQuestion (do not auto-run `init`)

## Shared Context

Documentation lives in `./docs` directory:
```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

Use `docs/` directory as the source of truth for documentation.

When authoring or refreshing architecture diagrams, prefer small Mermaid diagrams and verify that labels, arrows, and component boundaries remain readable in Markdown.

**IMPORTANT**: **Do not** start implementing code.
