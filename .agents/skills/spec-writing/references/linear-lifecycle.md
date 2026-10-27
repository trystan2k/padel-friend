# Linear lifecycle

## Epic lifecycle

Team and project URL should be get from project's AGENTS.md.

| State | Meaning | Who moves it here |
| --- | --- | --- |
| `Backlog` | Intent captured, no spec yet | anyone |
| `Spec Review` | Spec published, developers, architects, and the PO review it and comment on the epic | `spec-writer-specialist` |
| `Ready` | Spec passed review and the Definition of Ready | **PO only** |
| `In Progress` | `delivery-orchestrator` is implementing | `delivery-orchestrator` |
| `In Review` | PR open against `develop` | `delivery-orchestrator` |
| `UAT` | Merged to `develop` and deployed to staging; stakeholders run the §11 scenarios | after merge |
| `Done` | Stakeholders accepted on staging | PO |
| `Blocked` | Waiting on an external decision or dependency | anyone, with a comment saying why |

The spec writer only ever sets `Backlog` or `Spec Review`. Moving to `Ready` is the PO's approval.

## Structure

- **Epic** = one parent issue. Title: `Epic: <title>`. Label: `Epic`. Description: the filled `docs/templates/epic-spec.md`.
- **Slice** = one sub-issue per §12 row, linked with `--parent <epic>`. Title: `S-n: <slice title>`. Label: `task`. State: same as the epic. Description:

```markdown
Part of <epic ID>: <epic title>. The epic spec is the source of truth; this issue only scopes the slice.

## Goal

<What this slice delivers, one or two sentences.>

## Blocked by

<S-n slices of this epic, or "None">

## Acceptance criteria

<The full Given/When/Then text of each AC this slice owns, copied from the epic §6.>

## Notes

<HITL reason, Pen frames, or the §8.2 items this slice touches.>
```

## Revisions

- Review comments live on the epic in Linear. Read them with `linear issue view <ID>` (comments are included).
- Apply each accepted comment to the spec, add a D-n row for each decision, and republish the whole description. Never edit only one part of it.
- When slices change, update existing sub-issues by ID. Cancel removed slices; never delete them.
- After `Ready`, a spec change needs the PO's approval and moves the epic back to `Spec Review`.
