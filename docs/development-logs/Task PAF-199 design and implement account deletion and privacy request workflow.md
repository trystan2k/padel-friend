---
title: PAF-199 Design and Implement Account Deletion and Privacy Request Workflow
type: development-log
permalink: docs/development-logs/task-PAF-199-design-and-implement-account-deletion-and-privacy-request-workflow
---

# Development Log: PAF-199

## Metadata

- Task ID: PAF-199 (P4 — Design and implement account deletion and privacy request workflow), with child breakdown PAF-230 through PAF-235 (Linear, PadelFriend team / PadelFriend project)
- Date (UTC): 2026-11-27T21:43:59Z
- Project: padel-friend
- Branch: `feature/PAF-199-account-deletion-privacy-request-workflow` (base `main` @ `1b317dc`)
- Commits: 19 commits verified on `main..HEAD` (delivery record cited 22; diffstat matches delivery exactly: 99 files, +18,493/−131). Unit commits: `76be2e9` (A), `2be9195` (B), `417cbd0` (C), `90af40a` (D), `9ccc9f4` (E), `8dd4e51` (F). Review-fix commits: `b12337f`, `f44d8cc`, `1c2aaf8`, `721b4ac`, `454abfc`, `e81499e`, `0c8b455`, `7b8a711`, `14a7ffe`, `76f0f5e`, `aba7e9b`, `3a3bef6`, `a8d2b4d`.

## Objective

- Deliver a secure, fully tested account deletion and privacy-request workflow: in-product deletion request controls, a safe operator-executed erasure pipeline (relational data, storage, Supabase Auth), irreversible anonymization of historic shared records, and a case lifecycle with auditability.
- Update the published privacy policy truthfully (no unverifiable claims) across en / pt-BR / es, and provide an operator runbook for handling privacy requests.
- Child scope: PAF-230 (data inventory + process definition), PAF-231 (historic participant separation), PAF-232 (verified deletion request processing), PAF-233 (request controls UI), PAF-234 (policy + runbook docs), PAF-235 (end-to-end verification).

## Implementation Summary

- **A — PAF-230 (`76be2e9`, docs)**: `docs/account-deletion-design.md` — evidence-classified account-data inventory (MS/LC/PO classes), inventory drift corrections C1–C10, privacy-request process definition, GDPR Art. 12 response timing. Records the binding owner decisions (see Key Decisions).
- **B — PAF-231 (`2be9195`, feat)**: separated historical participants from deleted accounts. New `participant_identities` anchor table (live/withdrawn) with a 45-edge re-anchor migration; `privacy_internal.erasure_dispositions` disposition registry that fails closed on any unclassified FK (exact-tuple mapping); erasure seam performing atomic re-key of historic rows to a random UUID with no old→new mapping persisted; reader/decoder adaptations using scope-local former-player keys (no stable cross-match identifier); 170-column text-redaction classification.
- **C — PAF-232 (`417cbd0`, feat)**: verified deletion request processing. Case lifecycle state machine (received → verified → ready → executing → app_data_erased → supabase_erased → closed, plus withdrawn/blocked) with one-open-case invariant and command/receipt pattern; digest-only identity challenge verification; single-use arm binding (plan revision, fingerprint, project ref); lease-fenced scheduled Worker processor (freeze → relational seam → storage batch deletion → Auth delete with absence proof); kill switch; scoped operator CLI (`scripts/privacy-operator.mjs`).
- **D — PAF-233 (`90af40a`, feat)**: account deletion request controls. Protected `/account-deletion` route + PlayerProfile entry point; four-part disclosure dialog; request status display and withdrawal; full i18n for en / pt-BR / es; Base UI + StyleX + design tokens; 20 UI behavior tests.
- **E — PAF-234 (`9ccc9f4`, docs)**: truthful privacy policy rewrite in all three locales — removed banned claims (no six-month retention claim, no Cloudflare three-day claim, no compliance certification claims); `PRIVACY_LEGAL_REVIEW_COMPLETED=false` with a visible pending-review note; `docs/privacy-request-runbook.md` operator runbook (Supabase automated deletion + manual steps for other processors).
- **F — PAF-235 (`8dd4e51`, test)**: `e2e/privacy-requests.spec.ts` — 9 end-to-end tests: happy path with server-side absence proofs and survivor parity across the three locales, withdraw / blocked / unclaimed paths, i18n smoke, keyboard/focus, 320px viewport, public `/privacy`; plus a historic-ref fix in the match-result model.
- **Review loop**: 8 delta review rounds plus closing verification (code + architecture in parallel; UX for UI deltas). 49 enforceable findings — including 3 critical — all fixed and verified; final verdict SHIP. Inherent limits dispositioned as observed (F50–F53): trusted-operator external observation, pre-migration parity, documented fail-closed COUNT_MISMATCH, AT testing, brief stale-ban window, post-purge obligation follow-up. Findings ledger: `docs/plan/PAF-199-findings.md`.
- **Review-fix commits**: `b12337f` (coverage gaps: membership-derived rebuild, awaiting-identity erasure surface, stale-JWT boundary), `f44d8cc` (R1 findings F5–F14), `1c2aaf8`/`721b4ac` (R2–R3: arm lifecycle, producer pause/quiescence, restore isolation), `e81499e`/`0c8b455`/`7b8a711` (R5–R7: marker-table isolation, event-ledger coverage, ban lease fence, overflow/pagination refusals), `14a7ffe`/`76f0f5e`/`aba7e9b`/`a8d2b4d` (R8–R12: snapshot-visibility cutoff, destructive-start ban fence, cleanup admission serialization + dispatch fence, null-token audit).

### Key mechanisms shipped

- `participant_identities` anchor (live/withdrawn) + `privacy_internal.erasure_dispositions` registry — fail-closed on unclassified FK via exact-tuple mapping.
- Atomic historic-record re-key to a random UUID with no persisted old→new identity mapping (irreversible anonymization).
- Scope-local former-player display keys — no stable cross-match identifier survives erasure.
- Case state machine + one-open-case invariant + command/receipt audit pattern.
- Single-use arm binding (plan revision / fingerprint / project ref) so stale plans cannot execute.
- Permanent dead-identity producer refusal (post-erasure writes rejected).
- Restore-isolation marker table (non-caller-settable) + erasure event ledger + snapshot-visibility count parity as authoritative restore coverage.
- Ban lease fencing + cleanup admission gate with dispatch fence + settle window.
- Null-token audit with `IS DISTINCT FROM` comparisons everywhere in privacy RPC fences.

## Files Changed

99 files changed, +18,493 / −131 vs base `1b317dc`. Grouped by area:

- Database (`supabase/migrations/`, 19 files): participant_identities anchor + 45-edge re-anchor, erasure disposition registry, privacy case tables, restore-isolation marker table, erasure event ledger, RPC fences.
- Privacy domain (`src/features/privacy-requests/` 6, `src/features/privacy/` 2): case lifecycle, verification, processor, operator commands.
- Matches/leagues/statistics/player/auth (`src/features/matches/` 11, `src/features/leagues/` 3, `src/features/statistics/`, `src/features/player/` 4, `src/features/auth/`): reader/decoder adaptations for former-player scope-local keys, ownership fallback (archive/retire/freeze), historic-ref fix.
- UI (`src/routes/_protected.account-deletion.tsx`, PlayerProfile entry, `src/locales/{en,pt-BR,es}/translation.json`): deletion request route, disclosure dialog, status/withdraw, i18n.
- Infrastructure (`src/lib/participant-ref.ts`, `src/lib/supabase/`, `src/lib/diagnostics.server.ts`, `src/server.ts`): participant reference helpers, scheduled Worker processor entry, diagnostics.
- Scripts (`scripts/privacy-operator.mjs` + `.d.mts`, `scripts/release-backup-restore.mjs` + `.d.mts`, `scripts/e2e-shards.mjs`): scoped operator CLI, restore rehearsal, e2e sharding update.
- Tests (`test/`, 33 files; `e2e/privacy-requests.spec.ts`): unit, integration (lifecycle, irreversibility, ownership, membership, text redaction, schema, migration-up, restore isolation/rehearsal, review/unclaimed paths), processor/operator/model/functions suites, fixtures (`privacy-request-fixtures.ts`, `account-erasure-fixtures.ts`), UI behavior tests, e2e.
- Docs/config (`docs/account-deletion-design.md`, `docs/privacy-request-runbook.md`, `docs/production-backup-plan.md`, `INITIAL_SETUP.md`, `package.json`, `knip.json`): design doc, runbook, backup-plan cross-reference, dependencies, knip config.

## Key Decisions

All owner decisions are binding and recorded in `docs/account-deletion-design.md` §1:

- **Hard delete** of active data and Supabase Auth account — no soft-delete retention of active records.
- **Irreversible anonymization** of historic shared records via internal random tombstone; no old→new identity mapping is persisted anywhere.
- **Ownership fallback** for orphaned historic artifacts: archive / retire / freeze, preserving official results.
- **Generic localized placeholder** disclosed above a defined visibility threshold (no per-name special-casing).
- **90-day purge** of case records after closure.
- **Processor split**: Supabase Auth deletion automated (scheduled Worker); other processors handled manually per runbook.
- **Truthful privacy policy**: only verifiable statements; legal review explicitly flagged as pending external owner action (`PRIVACY_LEGAL_REVIEW_COMPLETED=false`), never claimed as complete.
- Engineering decisions derived from review: fail-closed disposition registry (unclassified FK blocks erasure), snapshot-visibility count parity as authoritative restore coverage, marker-table restore isolation non-settable by callers, lease fencing for ban/cleanup operations with admission + dispatch fences and settle window.

## Validation Performed

- Static hooks green on all unit commits (lint-staged, commitlint, typecheck).
- Full unit suite: 325 files / 5,232 tests — green.
- Full integration suite: 147 files / 1,374 tests (1 pre-existing skip) — green on fresh test-stack `db:reset` (test stack `test/stack/supabase/`, ports 5542x).
- E2E: 9/9 passing (`e2e/privacy-requests.spec.ts`; fabricated `@test.local` actors, TEST stack, no external calls) — happy path with server-side absence proofs + survivor parity ×3 locales, withdraw/blocked/unclaimed, i18n smoke, keyboard/focus, 320px, public `/privacy`.
- `db:types:check` green after each migration.
- Review loop: 8 delta rounds + closing verification; 49 enforceable findings (3 critical) all fixed and re-verified; final verdict SHIP; inherent limits dispositioned (F50–F53).
- Production untouched: no deploy, no production data access; hosted-metadata comparison (PO-1) pending owner evidence.
- Final `pnpm complete-check` runs at the delivery gate (per repo mandate, outside this log).

## Risks and Follow-ups

- **PO-1 hosted evidence request** (owner): compare hosted Supabase metadata against assumptions; pending owner evidence.
- **Legal review** (owner): external privacy-policy legal review pending; policy ships with visible pending-review note and no compliance claims until completed.
- **PAF-177 restore-gate integration**: wire restore isolation into the production restore gate when automated backups land.
- **AT (screen-reader) manual testing** recommended for the /account-deletion flow and disclosure dialog.
- Rate-limit incident mid-delivery: recovered via fresh-session handoff; no work lost (recorded for delivery-history context).
- Documented inherent limits (F50–F53): trusted-operator external observation, pre-migration parity, fail-closed COUNT_MISMATCH behavior, brief stale-ban window, post-purge obligation follow-up — accepted and documented in the findings ledger.
