---
name: implement-plan
description: Execute a plan from /jira-plan using parallel subagents (haiku, sonnet, opus) — each agent specializes in its task with clear file ownership boundaries
user-invocable: true
---

# Implementation Plan Executor

Execute a Jira implementation plan (output of `/jira-plan`) using coordinated multi-agent squad. Each agent runs in parallel within assigned work boundaries, preventing merge conflicts and blocking on dependencies. Write code first, test second, review pre-landing, and document last.

**Raw arguments:**
`$ARGUMENTS`

**Execution language: English** — all phases, reports, comments in English.

## Usage

```
/implement-plan KAN-123
/implement-plan --from KAN-123
/implement-plan docs/migration/plans/KAN-123/KAN-123-implementation-plan.md --parallel 3
/implement-plan KAN-123 --skip-tests --skip-review
/implement-plan --focus phase-01 --from KAN-123  # Debug single phase
```

## Core constraints

- Implements code (writes files, runs tests, commits).
- No phase runs before dependencies complete.
- No file touched by >1 phase (design error if true).
- Model tier: **Haiku** (review/test), **Sonnet** (code/debug), **Opus** (red-team plan).
- Plan must name concrete files, PRs, test cases — refuse vague plans.

## Argument handling

| Argument | Meaning |
| --- | --- |
| `KAN-x` (e.g., `KAN-123`) | Direct issue key (auto-constructs `docs/migration/plans/<KEY>/<KEY>-implementation-plan.md`) |
| `docs/migration/plans/<KEY>/<KEY>-implementation-plan.md` | Direct plan file path |
| `--from <KEY>` | Construct path as `docs/migration/plans/<KEY>/<KEY>-implementation-plan.md` |
| `--parallel N` | Max concurrent agents (default 3, cap 5) |
| `--skip-tests` | Skip test verification (dangerous) |
| `--skip-review` | Skip pre-landing code review (dangerous) |
| `--focus phase-XX` | Run only one phase (debug mode) |
| `--no-docs` | Skip documentation updates |

## Phase 0 — Resolve and validate plan

1. **Resolve path:**
   - Direct issue key given (e.g. `KAN-123`, matches `^[A-Za-z]+-\d+$`) → construct `docs/migration/plans/<KEY>/<KEY>-implementation-plan.md`
   - Full path given → use it
   - `--from <KEY>` → construct `docs/migration/plans/<KEY>/<KEY>-implementation-plan.md`
   - Neither → scan `docs/migration/plans/*/` for most recent `*-implementation-plan.md`
   - Ambiguous → ask user to pick

2. **Read and extract:**
   - Issue key, link
   - Problem statement (section 1)
   - Proposed approach (section 5)
   - Work breakdown (section 7) — tasks, files, dependencies, estimates
   - Data/migration impact (section 8)
   - Risks (section 9)
   - Test strategy (section 10)
   - Open questions (section 12)

3. **Validate:**
   - Every file in work breakdown must exist OR be created by a task
   - Every task has sequence number
   - No task references missing dependencies
   - **No file modified by >1 task** (design error → stop, ask user to clarify ownership)
   - Open questions blocking implementation → ask: "Block or assume default?"

4. **Report:** Issue, approach (1–2 sent), task count, parallelization strategy

## Phase 1 — Decompose into subagent tasks

Create task per work-breakdown item:

```
Task: <ISSUE-KEY>-<N>: <name>
Scope: <files>
Model: haiku | sonnet | opus
Deps: <task IDs>
Est: <minutes>
```

**Model assignment** (strict):

| Task | Model | Reason |
| --- | --- | --- |
| Implementation: code, migrations, config | **Sonnet** | Full context, error handling, design |
| Testing: unit/integration tests | **Haiku** | Straightforward; map files → tests |
| Code review: pre-landing security, perf | **Haiku** | Known patterns |
| Documentation: README, API docs | **Haiku** | Lightweight |
| Plan red-team: challenge assumptions | **Opus** | High stakes |
| Debug: traces, logs, integration | **Sonnet** | Timing, stack traces |

**Dependency graph:**

No-dep phases run parallel (up to `--parallel` limit). Phases wait for blockers. Report critical path (longest dep chain).

## Phase 2 — Parallel implementation

For each task in dependency order:

1. **Create task** via `TaskCreate`
2. **Dispatch subagent:**
   - fullstack-developer (code) → Sonnet
   - tester (tests) → Haiku
   - code-reviewer (review) → Haiku
   - docs-manager (docs) → Haiku
3. **Wait for dependencies** before starting
4. **Track progress** in `.tasks.json` locally

Example tracking:
```json
{
  "plan": "docs/migration/plans/KAN-194/KAN-194-implementation-plan.md",
  "issue": "KAN-194",
  "tasks": [
    {
      "id": "KAN-194-1",
      "name": "Schema migration",
      "status": "completed",
      "agent": "fullstack-developer (sonnet)",
      "duration": 45,
      "files": ["prisma/schema.prisma", ...],
      "result": "✓ Schema, migration, idempotency verified"
    }
  ]
}
```

## Phase 3 — Test verification (parallel)

After implementation:

1. **Spawn tester (haiku):**
   - Scope: Files from tasks 1–N
   - Run: diff-aware tests only (`npm test -- --onlyChanged`)
   - Report: pass/fail, coverage delta, unmapped files
   - If fail/coverage drop → halt, ask user fix or proceed

2. **Integration test** (if suite exists):
   - Verify phases don't break each other
   - If fail → halt, report

**Skip:** `--skip-tests` (dangerous)

## Phase 4 — Pre-landing code review (serial)

After tests pass:

1. **Spawn code-reviewer (haiku):**
   - Scope: Files from tasks 1–N
   - Focus: concurrency, data handling, auth, N+1, error boundaries, trust
   - Return: findings (critical, high, medium, low)
   - Critical findings → halt
   - High findings → ask user fix or accept risk
   - Medium/low → proceed with findings noted

**Skip:** `--skip-review` (dangerous)

## Phase 5 — Documentation updates (serial)

After code review:

1. **Spawn docs-manager (haiku):**
   - Scope: Features from plan
   - Update: README, API docs, migration guides
   - Verify: code examples still compile/run
   - Don't create new docs unless plan says so

**Skip:** `--no-docs`

## Phase 6 — Integration verification (conditional)

If any phase failed/skipped:

1. Verify build: `npm run build`
2. Run full test suite: `npm test`
3. If fail → report, ask user fix before landing

Pass → proceed to Phase 7.

## Phase 7 — Land changes

**Summary report:**
- Plan path, tasks (N completed, 0 failed), duration
- Critical path
- Work table (task, files, status, notes)
- Testing (unit/integration/coverage)
- Code review findings (critical/high/medium/low)
- Docs updated
- Next steps (retry/commit/push)

**Auto-commit** (default):
```bash
git add .
git commit -m "feat(<ISSUE-KEY>): <summary>

Plan: <path>
Co-authored-by: Claude Code Fullstack Agent"
```

**Manual** (ask first):
User confirms staged files, then commits.

## Failure modes

| Failure | Recovery |
| --- | --- |
| Task fails | Report error log. Ask: "Retry with `--focus <TASK-ID>`?" |
| Tests fail | Show tests. Retry `--focus <impl-TASK-ID>` to debug. |
| Review blocks | Show findings. Ask: "Fix or accept risk?" |
| Integration fails | Halt. Ask: "Which task broke this?" |
| Plan not found | Stop, ask for clarification |
| Ambiguous deps | Report cycle, halt |

## Special handling

**`--focus <TASK-ID>`:**
- Run only that task, skip dependency check
- Useful for retry after fix
- Warn if deps unmet, but proceed if user confirms

**Partial implementation:**
- Task 1 succeeds, task 2 fails → don't auto-retry
- Report error, ask: fix manually or retry?
- If retry, run task 2 in isolation

**File conflict (>1 phase touches):**
- Detect in Phase 1, halt
- This means plan is broken
- Ask user re-run `/jira-plan --rounds 2` to re-debate

**Codex integration:**
- If implementation fails with "needs deep debugging", offer: "Run with `/codex:rescue` instead?"
- Not a Codex command itself; uses regular Claude agents

## Subagent responsibilities

### fullstack-developer (Sonnet)

Input: Plan path, task ID, files to modify

- Read plan, extract task details
- Read existing code at all paths
- Write implementation
- Add unit tests for new logic
- Run typecheck/build
- Report: files modified, line counts, test results

### tester (Haiku)

Input: Plan path, changed files

- Map changed files → test files (diff-aware)
- Run relevant tests only
- Analyze coverage delta
- Report unmapped files
- Halt if tests fail/coverage drops

### code-reviewer (Haiku)

Input: Plan path, changed files + git diff

- Review for concurrency, data handling, auth, perf
- Report findings (critical/high/medium/low)
- Halt if critical
- Ask user if high

### docs-manager (Haiku)

Input: Plan path, changed features

- Read existing docs
- Update README, API docs, migration guides
- Verify code examples
- Report what was updated

## Best practices built in

1. **File ownership:** Each phase owns specific files. Read from others, write to yours only.
2. **Dependency sequencing:** Long chains run sequential; independent run parallel.
3. **Fail fast, report loud:** Stop at first critical error, human decides.
4. **Diff-aware testing:** Run only tests that matter, not full suite.
5. **Pre-landing gates:** Code review → tests → design.
6. **No silent failures:** Every failure gets a human decision point.
