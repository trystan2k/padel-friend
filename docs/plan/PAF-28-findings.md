# PAF-28 Findings Ledger

| id  | severity | location                                         | title                                                           | status | owner                     | iteration |
| --- | -------- | ------------------------------------------------ | --------------------------------------------------------------- | ------ | ------------------------- | --------- |
| F1  | major    | src/features/community/community.functions.ts:23 | PostgREST `*` wildcard alias can bypass literal-search escaping | fixed  | implementation-specialist | 1         |
| F2  | major    | src/features/community/community.functions.ts:32 | Cap-crossing `next_offset` rejected by the validator            | fixed  | implementation-specialist | 1         |

## Notes

- F1 confirmed empirically: PostgREST `.ilike` treats `*` as a `%` wildcard (probe: `search='*'` and `search='Star*'` matched both `Star*Club` and `StarXClub`). Fixed by switching to regex-escaped `filter('name','imatch',...)`; real-DB tests assert literal `*`/`%`/`_` and decoy exclusion.
- F2: `next_offset` is now `null` when the continuation would exceed the accepted offset cap (10000).
- Both fixes are uncommitted at re-review time; delta baseline is commit `39a7efe`.
- AC4 (server-payload scope) and the AC3 matches deferral to PAF-4 are intentional, not findings.
