---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
user-invocable: true
---

Implement the work described by the user in the spec or tickets.

Use tests-first development where it provides a stable behavioral seam. For database
concurrency rules, verify against real PostgreSQL rather than mocks or SQLite.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit or push only when the user explicitly asks for the corresponding Git operation.
