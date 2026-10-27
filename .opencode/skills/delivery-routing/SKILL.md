---
name: delivery-routing
description: Choose S, M or L delivery routing and risk-triggered reviews for approved tasks.
---

# Delivery routing

Load delivery-policy and follow AGENTS.md. Choose by risk, not file count:

| Path | Eligibility | Actor and evidence |
| --- | --- | --- |
| S | Objectively mechanical; no behavior, security, contract or design decision. | Coordinator may edit within scope; combined review and applicable quality obligations remain. |
| M | Bounded implementation or fix requiring judgment, without L triggers. | Implementation or bug-fix specialist; planner only for unresolved design; code reviewer covers ordinary architecture too. |
| L | Auth/RLS, migrations, trust or permission boundaries, plugin guards, secrets, public contracts, cross-cutting architecture or genuinely complex scope. | Planner when needed, specialist implementation, code reviewer and separate independent architecture reviewer. |

UX review is risk-triggered: visible behavior, fidelity, interaction, accessibility, responsive layout, localization or design tokens. Skip mechanical import or formatting changes only with a reason; uncertain UI risk goes to UX review. Batch independent metadata reads and mechanical edits; preserve dependency ordering. Do not split an already approved single-unit scope merely to create more issues.
