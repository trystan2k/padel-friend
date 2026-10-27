---
name: spec-writing
description: "Turn an intent into an implementation-ready epic spec for Linear: ground it in the code and docs, grill the PO until every requirement and acceptance criterion is settled, fill docs/templates/epic-spec.md, and check it against the Definition of Ready. Use when writing, revising, or checking whether a spec is ready for implementation."
---

# Spec Writing

A spec is the contract between the PO and the delivery workflow. `delivery-orchestrator` builds from it without asking the PO again, so anything the spec leaves vague becomes a guess during implementation. The job is to remove every guess before the epic reaches `Ready`.

Template: [`docs/templates/epic-spec.md`](../../../docs/templates/epic-spec.md). Lifecycle and Linear conventions: [`references/linear-lifecycle.md`](references/linear-lifecycle.md).

## 1. Ground — facts before questions

Collect the facts yourself. Questions to the PO are for decisions only.

- **Intent:** the file, Linear issue, or text the PO gave. Restate it in one sentence and confirm it.
- **Product:** the PRD sections it touches (`docs/ORIGIN_PRD.md`), with section numbers.
- **Architecture:** ADRs in `docs/adr/` and existing specs or epics it depends on or conflicts with.
- **Code:** what exists today for this area: routes, feature modules, tables, RLS policies, API handlers, tests. Record each with `path:line`. On greenfield, record that nothing exists and which conventions apply (`tanstack-start-architecture`).
- **Design:** the Pen frames in `design/origin.pen` that cover the UI. If the design is missing or unclear, ask the PO. Never invent a design.
- **Terms:** domain words the intent uses. Match them to the PRD and glossary. Each conflict becomes a grilling question.

Grounding is done when every section of the template has either a fact or a named open question.

## 2. Grill — settle every decision

Load the `grilling` skill and run its rounds. Draw questions from [`references/question-bank.md`](references/question-bank.md): every topic in it is either answered, marked N/A with a reason, or asked.

- Put a recommended answer on every question, based on the facts from step 1. Cite the code or doc behind it.
- When the intent contradicts the PRD, an ADR, or the current code, show the contradiction and ask which one wins.
- Push back on scope creep: anything outside the intent goes to **Out of scope** unless the PO explicitly adds it.
- Record each answer as a `D-n` row in §14 as you go.

Grilling is done when the frontier is empty and §15 Open questions is empty, or holds only items the PO explicitly accepts as non-blocking.

## 3. Write — fill the template

- English, plain and specific. No marketing words.
- **Requirements** say "must". One behavior per FR.
- **Acceptance criteria** use Given/When/Then with observable results (status codes, visible text, database state). Each one maps to an FR and names its test level. Cover the main path, each error path, and each permission boundary.
- **UAT scenarios** are written for a non-developer on staging and map to ACs.
- **Delivery slices** are thin vertical slices (schema → API → UI → tests), each demoable on its own. Prefer AFK. Mark HITL only when a human decision or design review is needed mid-build.
- **Estimated tier** uses the `delivery-orchestrator` triage table: auth, data access, migrations, or several slices mean L.
- Keep IDs stable across revisions. Never renumber; mark removed items `~~removed~~` with the decision that removed them.

## 4. Check — Definition of Ready

Run [`references/definition-of-ready.md`](references/definition-of-ready.md) item by item and report each as pass or fail. A failing item goes back to step 2 or 3. Present the result to the PO with the draft.
