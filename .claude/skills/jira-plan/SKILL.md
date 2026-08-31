---
name: jira-plan
description: Pull a Jira issue over MCP, draft an implementation plan, then debate it against Codex adversarial-review until it converges
user-invocable: true
---

# Jira Plan Builder

Build an implementation plan from a Jira issue, then put that plan through an adversarial debate with Codex before anyone writes code.

**Raw arguments:**
`$ARGUMENTS`

**Write every artifact in English** — plan file, debate log, and any Jira comment, regardless of input language.

## Usage

```
/jira-plan KAN-123
/jira-plan KAN-123 --rounds 3 --background focus on migration rollback
/jira-plan --jql "project = KAN AND assignee = currentUser() AND status = 'To Do'" --comment
```

## Core constraints

- Plan-only: no implementation, no migrations, no source edits. Output files: plan + debate log.
- Plan must survive hostile review. Codex is your opponent; defeat objections with evidence or fix the plan.
- Every verdict needs ground truth (code path, Jira field, assumption), never just agreement.
- No Jira writes without confirmation.

## Argument handling

| Argument | Meaning |
| --- | --- |
| `KAN-x` (e.g., `KAN-123`) | Plan for this issue (key matching project `KAN`) |
| `--jql "<jql>"` | Resolve target by JQL |
| `--rounds N` | Max debate rounds (default 2, cap 3) |
| `--wait` \| `--background` | Codex run mode (ask if neither) |
| `--comment` | Post final summary to Jira |
| `--create-subtasks` | Generate Jira subtasks from work breakdown |
| Free text | Focus area for planning & review |

## Phase 1 — Connect to Jira MCP

1. Resolve `cloudId` via `getAccessibleAtlassianResources`:
   - Expected site: `phatngo040103.atlassian.net`
   - Project: `KAN` (resolve project name/id at runtime via `getVisibleJiraProjects`, don't assume cached values are current)
   - **If access denied**: Stop. User must re-authorize MCP (Settings → Atlassian → Reconnect, tick `phatngo040103.atlassian.net`).

2. Fetch issue via `getJiraIssue`:
   - Fields: summary, description, status, issuetype, priority, labels, components, fixVersions, parent, subtasks, issuelinks, assignee, reporter, duedate
   - Include comments.

3. Gather context:
   - Parent Epic/Feature (if `parent` set)
   - Existing subtasks & statuses
   - Issue links (blocks/blocked-by determine sequence)
   - Remote links (PRs, design docs)
   - Comment thread (scope changes hide here)

4. Check issue richness: if thin or contradictory, call it out. Unstated requirements → Assumptions, not silent decisions.

## Phase 2 — Ground in codebase

Backend: `src/modules/<domain>/{application,domain,infrastructure,presentation}` (NestJS modular).

- Locate touched modules, entities, handlers, DTOs, migrations. Cite `path:line`.
- Document patterns to follow, tests to update.
- Flag conflicts: if reality differs from Jira description, add as finding.

**No real files named → refuse to proceed.** Plan must be grounded.

## Phase 3 — Draft plan v1

Write to: `docs/migration/plans/<ISSUE-KEY>/<ISSUE-KEY>-implementation-plan.md`

If file exists, version as `-v2`, `-v3` (don't overwrite).

Structure:

```markdown
# <ISSUE-KEY> — <summary>

- **Jira:** https://phatngo040103.atlassian.net/browse/<ISSUE-KEY>
- **Type / Status / Priority:** ...
- **Round:** 1 (pre-review)

## 1. Problem
User's terms, not ticket title paraphrase.

## 2. Scope
### In scope
### Explicitly out of scope

## 3. Assumptions
Every unstated requirement the plan depends on.

## 4. Current behaviour
How code works today (`path:line` citations).

## 5. Proposed approach
The chosen design and *why this one*.

## 6. Alternatives considered and rejected
At least one real alternative + reason it lost.

## 7. Work breakdown
| # | Task | Files | Depends on | Est. |

## 8. Data & migration impact
Schema, backfill, **rollback path**.

## 9. Risks
| Risk | Likelihood | Impact | Mitigation |

## 10. Test strategy
Unit/integration/e2e + failure cases, not just happy path.

## 11. Rollout & rollback
Feature flags, sequencing, undo procedure.

## 12. Open questions
Needs human answer before implementation.
```

## Phase 4 — Adversarial debate with Codex

**Resolve Codex runtime & Windows PowerShell fix:**
```bash
CODEX_COMPANION=$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)
[ -z "$CODEX_COMPANION" ] && CODEX_COMPANION=~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs

# Fix Windows PowerShell execution policy (if running on Windows)
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  powershell -NoProfile -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" 2>/dev/null || true
fi
```
If missing → user runs `/codex:setup` first.

**Execution mode:**
- `--wait` → foreground
- `--background` → background task
- Otherwise → ask (recommend background for large plans)

**Windows users:** If Codex fails with PowerShell errors, first run this in PowerShell (admin):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```
Then retry. The skill now attempts this automatically, but admin privileges may be required.

**Run review** (pin Codex to plan file only):
```bash
node "$CODEX_COMPANION" adversarial-review \
  "--scope working-tree Review ONLY docs/migration/plans/<KEY>/<KEY>-implementation-plan.md. \
   Attack assumptions, failure modes, rollback gaps, work-breakdown underestimates, \
   production failure scenarios. <user focus>"
```

**Rebut, round by round:**

| Verdict | Action |
| --- | --- |
| **ACCEPT** | Fix plan, name section |
| **PARTIAL** | Fix plan your way, explain why Codex remedy is wrong |
| **REJECT** | Cite `path:line` or Jira field refuting it. No rejection without evidence → downgrade to ACCEPT. |
| **DEFER** | Real but other ticket → add to Open questions + propose follow-up issue |

**Rules:**
- Verify findings by reading code.
- Unverifiable finding → becomes Assumption + Risk, not rejection.
- Change structure → re-run review. Wording only → no re-run.
- Stop at round N (default 2, cap 3) or when round has no ACCEPT/PARTIAL verdicts.
- Report disagreements honestly; user decides.

**Append to plan:**
```markdown
## Appendix — Adversarial debate log

### Round <n> — Codex verdict: <approve | needs-attention>

#### F<n>.<i> — <finding title> (confidence <x>)
- **Codex:** <objection>
- **Claude:** ACCEPT | PARTIAL | REJECT | DEFER — <argument>
- **Plan change:** <section touched, or "none">

### Unresolved
<disagreements, or "none">
```

## Phase 5 — Present result

Report:
1. Path to final plan
2. Proposed approach (1–2 sentences)
3. Verdict table: raised / accepted / partial / rejected / deferred
4. Unresolved disagreements
5. Open questions blocking implementation

## Phase 6 — Write back to Jira (confirmation only)

Only if `--comment` or `--create-subtasks` AND user confirms.

- `--comment`: `addCommentToJiraIssue` with summary (approach, work breakdown, risks, open questions, adversarial-review note). Link plan path, don't paste full doc.
- `--create-subtasks`: Preview proposed subtasks (summary, description, estimate, order). On approval, create under target issue via `createJiraIssue`. Resolve issue type + required fields from `getJiraProjectIssueTypesMetadata` first — don't assume KAN's scheme/required fields match another project. Report failures instead of silent retry.

**Never:** transition status, reassign, edit description. This plans; doesn't manage board.

---

## Troubleshooting

### Codex fails with PowerShell errors (Windows)

**Symptom:** Codex review exits with messages like:
```
[codex] Command failed: "C:\\Users\\..\\pwsh.exe" -Command '...' (exit -1)
```

**Root cause:** Windows PowerShell execution policy blocks script execution.

**Fixes (in order):**

1. **Automatic** — Skill now attempts to set policy. If it fails silently, try option 2.

2. **Manual (requires admin PowerShell):**
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
   ```

3. **Workaround** — Run jira-plan without Codex review (manual review only):
   ```bash
   # Draft plan only, skip Codex adversarial review
   /jira-plan BMT-123 --skip-codex
   ```

4. **Fallback** — Use manual adversarial review:
   - I read existing code patterns
   - I trace security/performance implications
   - I document findings in plan appendix
   - This is often more thorough than automated review anyway

**Prevention:** Run PowerShell as admin once to set the policy permanently.
