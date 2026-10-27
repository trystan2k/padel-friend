---
name: delivery-policy
description: Apply completion-first delivery, scoped handoffs and approval boundaries when coordinating work.
---

# Delivery policy

Follow AGENTS.md when imported skill guidance conflicts with project conventions. Complete all required and related findings within approved scope; two failed fix rounds trigger diagnosis, not deferral. Do not create follow-ups or reduce scope without explicit user approval.

An approved, unambiguous task authorizes ordinary implementation and scoped commits. Honor explicitly requested plan or design approvals and resolve scope decisions with the user. Initial push and PR creation require explicit user evidence; merge, destructive actions and scope changes each require separate evidence. Child flags alone are not evidence. Approved PR lifecycle includes necessary in-scope review-fix pushes, not new scope or merge.

Use one commit per agreed unit after in-scope review fixes. Stage explicit paths only; exclude unrelated files, private telemetry, temporary validation output and full-diff bundles. Durable requested plans, findings and logs are allowed. Do not place issue IDs in commit subject/body or PR title; PR description links the Linear issue, and the issue links back. Request Copilot review when creating a PR.

Handoff: task and acceptance criteria subset, action, file boundary, plan/policy references, baseline and delta, constraints and approval evidence. Response: status, files, acceptance evidence, findings/blockers and next owner. Reuse intake and pass references rather than full source or diffs. Report partial timing honestly and never claim skipped checks passed.
