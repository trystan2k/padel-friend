# PAF-27 Findings Ledger

| id  | severity | location                                          | title                                                                   | status   | owner                     | iteration |
| --- | -------- | ------------------------------------------------- | ----------------------------------------------------------------------- | -------- | ------------------------- | --------- |
| F1  | minor    | src/features/community/community.validators.ts:90 | Settings JSON byte cap differs from PostgreSQL JSONB limit              | deferred | deferred                  | 1         |
| F2  | minor    | src/features/community/community.validators.ts:65 | PostgreSQL-invalid strings (NUL, unpaired surrogates) pass validation   | fixed    | implementation-specialist | 1         |
| F3  | minor    | src/features/community/community.functions.ts:31  | JSONB size CHECK failures lack stable input-error mapping               | deferred | deferred                  | 1         |
| F4  | minor    | test/community.integration.test.ts:349            | Handler denial coverage omits hidden-private targets and demoted admins | deferred | deferred                  | 1         |

## Notes

- No critical or major findings. No blocking fixes.
- F2 is a trivial touched-file fix (PostgreSQL-compatible string guard) applied in this delivery.
- F1 and F3 are the same theme (settings JSONB size parity / CHECK error mapping); deferred — the DB still protects stored data.
- F4 is a test-coverage gap; deferred.
- F1/F3/F4 will be handed off as a follow-up issue.
