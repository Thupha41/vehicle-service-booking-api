---
name: jira-ticket-writer
description: >-
  Writes Jira tickets for project BMT (booking-multitenant.atlassian.net) in the house
  format: business description, business rules quoted from the BRD, a table of the API
  endpoints that already exist, and Given/When/Then acceptance criteria — deliberately
  no code instructions. Use this whenever work involves creating, rewriting or reviewing
  a BMT ticket, epic or backlog item — "tạo ticket", "viết task cho Jira", "thêm epic",
  "mô tả task này rõ hơn", "đưa BR-CTZ-xx vào backlog", turning docs/15/16/17 or the BRD
  into issues, or drafting a sprint. Also use it when someone asks for a ticket that
  merely sounds like a work item for this platform, even if they never say "Jira".
user-invocable: true
---

# Writing BMT tickets

A ticket in this project is read by a developer who has not been in the conversation
where the work was decided. It has to carry the business reason, the rule that makes the
behaviour non-negotiable, and what already exists — because without those three, the
developer either guesses the requirement or reinvents an endpoint that is already live.

What it must **not** carry is instructions on how to write the code. The people doing the
work know the codebase better than the ticket author does, and file paths go stale within
weeks. A ticket that says "edit `slot-reservation.service.ts` line 194" is worse than
useless once that file moves; a ticket that says "giữ chỗ phải hết hạn chính xác sau 15
phút vì RULE-05" stays true for the life of the project.

## The five sections

Every ticket uses this shape. Keep the headings in Vietnamese — the whole backlog is in
Vietnamese and mixed-language tickets read as sloppy.

```markdown
**Ưu tiên:** P0 · **Size:** M · **Sprint:** 02 (24–28/08/2026) · **Phân hệ:** <tên phân hệ>

## Mô tả
## Business rule liên quan (BRD)
## API hiện có
## Acceptance criteria
## Phụ thuộc
## Ngoài phạm vi
## Evidence phải gắn vào ticket
```

### Mô tả

State the business problem and why it matters, in language a project manager could follow.
Name the gap concretely: what the BRD asks for, what the system does today, why the two
differ. Two to four short paragraphs is usually right.

If the ticket is a decision rather than an implementation, say so in the first line and
list the questions that must be answered. Ambiguity that survives into implementation is
far more expensive than ambiguity resolved in a ticket.

### Business rule liên quan (BRD)

A table of the codes that govern the behaviour, with the rule text. Look each one up with
the bundled script rather than recalling it — the codes carry contractual weight because
the BRD is a signed document, and a misquoted rule can send someone building the wrong
thing:

```bash
python .claude/skills/jira-ticket-writer/scripts/brd_lookup.py BR-CTZ-10 RULE-05 NFR-09
```

The script prints every mention with surrounding context, and tells you when a code does
not exist. **A code that is not in the BRD must not appear in a ticket.** If you need a
rule the BRD does not state, write it as an explicit assumption and mark it as such.

Quote enough of the rule to be actionable — the threshold, the exception, the rationale —
not just its title. `BR-CTZ-15` means little; "BHYT tối đa 01 lượt/ngày/cơ sở cho cùng một
CCCD, ngoại lệ: được đặt thêm nếu chọn Dịch vụ hoặc Theo yêu cầu" can be implemented and
tested. Preserve `[Must]` / `[Should]` / `[Could]` markers; they decide what gets cut when
the schedule slips.

Free-text search helps when you know the behaviour but not the code:

```bash
python .claude/skills/jira-ticket-writer/scripts/brd_lookup.py --grep "giữ chỗ"
python .claude/skills/jira-ticket-writer/scripts/brd_lookup.py --section "Khung giờ"
python .claude/skills/jira-ticket-writer/scripts/brd_lookup.py --toc
```

For an infrastructure ticket with no business rule, cite the NFR that justifies it
(isolation, performance, audit) plus the fixed decisions in `docs/01-decisions.md`. There
is almost always something; work with no traceable requirement is work worth questioning.

### API hiện có

A table of endpoints that already exist and are relevant, each with its current state.
This is the section that most often changes how the work gets done, because the honest
answer is usually "more exists than you think".

| Endpoint | Hiện trạng | Ghi chú |
| --- | --- | --- |
| `POST /checkin/confirm` | Yêu cầu đăng nhập | Phải mở cho khách theo RULE-01 |

Get the real list from the code rather than guessing:

```bash
grep -rE "@(Controller|Get|Post|Put|Patch|Delete)\(" backend/src/modules --include=*.controller.ts
```

Mark each endpoint **giữ / sửa / mở cho khách / thay bằng cái khác**. When the ticket
creates something genuinely new, say "chưa có endpoint nào" — that is information too, and
it is the honest signal that the estimate should be larger.

For infrastructure tickets that change no contract, write "Không API nào thay đổi" and
then list the endpoint groups that must be smoke-tested, because a change with no API
surface can still break every endpoint underneath it.

### Acceptance criteria

Given / When / Then, each one checkable by someone who did not write the code. Bind the
numbers from the BRD: 15 phút, 5 lần sai, 30 giây, dưới 2 phút, 403. A criterion without a
number is usually an opinion.

Two kinds are easy to forget and are exactly what this project gets audited on:

- **Isolation by persona.** Staff token of hospital A against hospital B is 403 even when
  the resource id is real; a patient token carries no hospital and must work against both;
  wrong persona on a route is 403. `docs/migration/definition-of-done.md` has the full
  matrix — reference it instead of retyping it.
- **Failure containment.** Hospital A being down must not affect hospital B (NFR-07), and
  the control-plane database failing must fail closed rather than falling back.

### Phụ thuộc · Ngoài phạm vi · Evidence

Dependencies name what blocks this and what this blocks. "Ngoài phạm vi" is worth writing
carefully — it is how you stop one ticket from quietly absorbing three others, and it tells
the reviewer where the rest of the work lives.

Evidence follows `docs/migration/definition-of-done.md`. Reference it rather than copying
it; when that document changes, tickets that quoted it become quietly wrong.

## Before writing

Three checks, in order:

1. **Does a ticket already exist?** BMT has 86+ issues from `docs/migration/tasks/`
   (prefixes `PLT / DAT / BE / EXT / FE / CF / OPS / NET / QA / CUT`). Search first. When
   something overlaps, comment a cross-reference on the existing issue instead of creating
   a second one — a duplicated backlog is far harder to repair than a missing ticket.
2. **What does the code actually do today?** `docs/16-brd-parity-inventory.md` holds a
   measured BR-by-BR inventory. Trust it over memory, and re-measure when it looks stale.
3. **Which BRD codes apply?** Run the lookup script before writing a single rule.

## Jira mechanics

`references/jira-bmt-fields.md` has the cloudId, issue-type ids, transition ids, label
vocabulary, and the field quirks — notably that Story Points does not exist (size goes in a
label) and that **no MCP tool can create a sprint**. Read it before the first tool call so
you are not discovering the schema one failed request at a time.

## What gets rejected

These are real corrections from this backlog, not hypotheticals:

- **Implementation steps.** "Chuyển schema từ `prisma/schema/` sang `prisma/tenant/`,
  tạo `prisma.tenant.config.ts`…" was cut entirely. Describe the outcome; let the developer
  choose the route.
- **Invented requirement codes.** Every code must survive the lookup script.
- **Rule titles without content.** "Theo BR-CTZ-24" tells nobody that the limit is 5
  attempts and the lockout is 15 minutes.
- **Vocabulary the BRD does not use.** The BRD's slot states are `AVAILABLE` / `HELD`;
  writing `DRAFT` / `PUBLISHED` invents a model and quietly contradicts the spec.
- **Epics marked Done while their children are open.** State on the board should match the
  repository; when it does not, say so rather than papering over it.
- **Silently skipping the sprint** because the tool cannot create one. Name the limitation.

## Worked example

`BMT-95` is the reference ticket. It covers a decision task and shows all five sections
carrying weight: six open questions in the description, ten BRD rules quoted with their
thresholds, fifteen existing endpoints classified as keep/open/replace, and acceptance
criteria that include a business risk found by cross-checking the BRD against the schema —
that the BHYT one-visit-per-day quota is currently keyed to a patient record, so removing
the account requirement could let the same citizen bypass RULE-08.

That last point is the real value of the format. Reading the BRD and the code side by side
surfaces contradictions that neither document reveals on its own, and the ticket is the
right place to record them.
