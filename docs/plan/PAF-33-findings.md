# PAF-33 Findings Ledger

| id  | severity | location                    | title                                                             | status   | owner    | iteration |
| --- | -------- | --------------------------- | ----------------------------------------------------------------- | -------- | -------- | --------- |
| F1  | minor    | .github/workflows/ci.yml:26 | CI resets schema but never verifies generated types match it      | deferred | deferred | 1         |
| F2  | minor    | package.json:27             | Failed generation truncates tracked types before command succeeds | deferred | deferred | 1         |

## Notes

- No critical or major findings. No fix loop required.
- F1 and F2 are inherited hardening gaps (present before PAF-33), not introduced by this change; deferred.
- F1: a future gate could generate from a freshly reset schema into scratch output, apply the same formatter override, and compare against the committed types (non-mutating drift check).
- F2: a future generator wrapper could write to a temp file, format, and replace the tracked file only on success.
