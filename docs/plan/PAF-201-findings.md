# PAF-201 Findings Ledger

| id | severity | scope | location | title | status | owner | iteration | disposition evidence |
| -- | -------- | ----- | -------- | ----- | ------ | ----- | --------- | -------------------- |
| F1 | minor | required | src/features/public-homepage/public-homepage.styles.ts:57,148,184 | Untokenized homepage line heights (1.15/1.45) | fixed | bug-fixer-specialist | 1 | Fixed in `9b944be`: new primitives `font.line-height.snug` (1.15) + `comfortable` (1.45), all three literals now token references, numerically identical; UX/UI delta verdict approve (no regressions) |
| F2 | minor | required | test/auth.identity-guard.test.tsx:29 | Default identity-teardown destination lacks regression coverage | fixed | testing-automation-specialist | 1 | Fixed in `9b944be`: two DefaultProbe tests exercise the default retirement callback, `assign('/login')` asserted on account replacement + sign-out + mount-time replacement; retargeting fails them; code delta verdict: oracle valid |
| F3 | minor | required | src/features/public-homepage/public-homepage.functions.ts:12 | Thrown invalid-claims errors break public homepage | fixed | bug-fixer-specialist | 2 | Round 1 (`9b944be`) message-regex matcher incomplete — code+arch deltas flagged SyntaxError from auth-js decodeJWT. Round 2 (`54d6354`): catch-all inside claims lookup → guest + safe `emitDiagnostic('request.failure','failure',{code:'OPERATION_FAILED',source:'server-function'})`; client creation stays outside try (repo convention); tests: SyntaxError/transient/invalid-alg → false, missing-env propagates; code delta verdict approve (diagnostic fields allowlisted, no dead code) |

## Review provenance
- Full review 2026-11-18 on `338b67a` (base main): code-review (verdict request-changes), architecture-review (verdict request-changes), ux-ui-reviewer (verdict approve-with-findings). Bundles: docs/plan/PAF-201-bundle.md.
- Reviewer raw verdicts: UX/UI — approve-with-findings (F1). Code — request-changes (F2). Architecture — request-changes (F3).
- No unrelated/optional observations reported by any reviewer.

## Transition log
- 2026-11-18 full review on `338b67a`: F1/F2/F3 opened (verdicts: code request-changes, arch request-changes, ux approve-with-findings).
- Fix round 1 → `9b944be` (`fix: address review findings`): F1 tokenized (snug/comfortable primitives), F2 default-path tests added, F3 regex matcher + toClientError boundary. Static hooks initially rejected raw rethrow (`check:server-errors`); corrected to toClientError before commit landed.
- Delta round 1 on `9b944be`: UX/UI approve (F1 verified); code request-changes (F3: auth-js decodeJWT SyntaxError escapes matcher, `[major]` required); arch request-changes (same F3 gap). F2 oracle verified.
- Fix round 2 (orchestrator direct, small-change fast path) → `54d6354` (`fix: recover the public homepage from any claims lookup failure`): claims-lookup catch-all → guest + safe diagnostic; matcher removed; client-creation propagation kept; tests updated (SyntaxError, transient lookup, missing-env).
- Delta round 2 on `54d6354`: code verdict **approve** — F3 resolved, oracle valid, diagnostic allowlisted, no dead code. Ledger closed: all findings `fixed`.
