---
name: migration-task-runner
description: >-
  Drives a single 7A→multi-tenant migration task (Jira project BMT, specs in
  docs/migration/tasks/) from load to Done gate. Use this whenever you pick up a
  BMT-* ticket or a docs/migration task — e.g. "làm BMT-5", "start FE-00",
  "migrate the patient portal task", "kiểm tra BMT-13 đủ điều kiện Done chưa", or
  any time work touches docs/migration/. It sequences the mandatory phases
  (preflight, dependency/artifact check, source inventory, ownership check,
  baseline, implementation, verification, evidence, Done gate), points at the
  authoritative contract docs instead of restating them, composes the correct
  verification set per task, and refuses to mark Done when the completion gate is
  not met. This is the entry-point workflow skill; call applicable craft skills,
  such as the contract-first client, from inside the Implementation phase.
metadata:
  short-description: Run one BMT migration task from load to Done gate
---

# Migration task runner

This is a thin wrapper. The full, canonical workflow lives in one place so the
Claude and Codex copies never drift:

**Read `docs/agent-workflows/migration-task-runner.md` completely before any Jira,
source, dependency, readiness, or implementation action, then follow it exactly.**

That file is the single source of truth for the phase order, stop conditions,
verification composition, and evidence format. Do not reimplement or summarize the
workflow here — if it needs changing, edit the canonical file.
