# PAF-94 — Review Findings Ledger

| id | severity | location | title | status | owner | iteration |
| -- | -------- | -------- | ----- | ------ | ----- | --------- |
| F1 | major | test/fixtures.publication-trigger.test.ts:27 | `SET LOCAL` / `SET SESSION` / quoted `session_replication_role` assignments bypass the guard | fixed | testing-automation-specialist | 2 |
| F2 | minor | test/fixtures.publication-trigger.test.ts:85 | Batched negative controls only prove detection of the first synthetic case | fixed | testing-automation-specialist | 2 |

## Resolution notes

- **F1**: detector now accepts optional `LOCAL`/`SESSION`, optional single/double quoting of `session_replication_role`, `=` or `TO`, and the `set_config('<name>', …)` form. Mutation-proved per alternative: reverting the SET branch fails synthetic 9–12; removing LOCAL/SESSION fails 9–12; removing quoting fails 11; removing the `set_config` branch fails 13–14.
- **F2**: every unsafe synthetic record now runs alone through the shared checker and asserts its own path plus the helper guidance (15 independent cases). Mutation M4 (comment-separator removal) fails only synthetic 5, proving per-case sensitivity.
- Delta review at `de291de..working tree`: no findings. Guard test 17/17.
