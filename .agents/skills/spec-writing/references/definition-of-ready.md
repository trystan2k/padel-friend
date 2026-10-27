# Definition of Ready

An epic moves to `Ready` only when every item passes. The spec writer checks it before publishing and reports each item as pass or fail. The PO sets the `Ready` state after review. `delivery-orchestrator` runs the same check when it picks up an epic, and stops if an item fails.

## Content

1. Every template section is filled, or says `N/A — <reason>`.
2. §1 states the problem, the users, and at least one success metric.
3. §2 lists at least one out-of-scope item, or explains why there is none.
4. Every FR maps to at least one user story, and every user story to at least one FR.
5. Every FR is covered by at least one AC.
6. Every AC uses Given/When/Then, has an observable result, and names a test level.
7. ACs cover the main path, the error paths, and every permission boundary in §3.
8. §8.1 cites the current code with paths, or says greenfield.
9. Every new table in §8.2 has its RLS policies described.
10. New environment variables are listed by name only, never by value.
11. UI work names its Pen frames. If a frame is missing, the slice is HITL.
12. §11 has at least one UAT scenario per user story, runnable by a non-developer, with synthetic test data.
13. §12 slices are vertical, each lists its ACs, every AC belongs to a slice, and dependencies form no cycle.
14. §15 Open questions says `None`, or lists only items the PO accepted as non-blocking (recorded as a D-n row).

## Consistency

15. Nothing contradicts the PRD or an accepted ADR without a D-n row explaining the divergence.
16. Terms match the PRD and existing specs.
17. The estimated tier matches the `delivery-orchestrator` triage signals.

## Safety

18. No secrets, credentials, real client data, or PII anywhere in the spec, examples, or test data.
