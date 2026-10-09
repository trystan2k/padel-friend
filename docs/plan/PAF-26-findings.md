# PAF-26 Findings Ledger

| id  | severity | location                                                    | title                                                                                          | status   | owner                         | iteration |
| --- | -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------- |
| F1  | major    | supabase/migrations/20261002055953_community_domain.sql:30  | Inactive NULL-end CHECK passes and permanently blocks rejoin                                   | fixed    | implementation-specialist     | 1         |
| F2  | major    | supabase/migrations/20261002055953_community_domain.sql:206 | Invitation guard blocks first redemption even by trusted RPC                                   | fixed    | implementation-specialist     | 1         |
| F3  | major    | supabase/migrations/20261002055953_community_domain.sql:179 | Pending lifetime conflated with historical active-membership interval                          | fixed    | implementation-specialist     | 1         |
| F4  | minor    | supabase/migrations/20261002055953_community_domain.sql:15  | Community and venue updated_at never advance after edits                                       | fixed    | implementation-specialist     | 1         |
| F5  | minor    | test/community.integration.test.ts:375                      | Pending own-row activation untested                                                            | fixed    | testing-automation-specialist | 1         |
| F6  | minor    | test/community.integration.test.ts:386                      | Invitation UPDATE denial unproved                                                              | fixed    | testing-automation-specialist | 1         |
| F7  | minor    | test/community.integration.test.ts:116                      | Fixture setup in first test breaks name-filtered execution                                     | deferred | deferred                      | 1         |
| F8  | minor    | test/community.integration.test.ts:239                      | Rejoin removes inactive-only actor before role matrix                                          | deferred | deferred                      | 1         |
| F9  | minor    | supabase/migrations/20261002055953_community_domain.sql:225 | Audit cannot identify settings or venue changes                                                | deferred | deferred                      | 1         |
| F10 | major    | supabase/migrations/20261002055953_community_domain.sql:32  | F3 incomplete: inactive membership can end before activated_at (inverted eligibility interval) | fixed    | implementation-specialist     | 2         |

## Notes

- F1, F2, F3 were blocking majors; fixed in iteration 1 and pending delta re-review.
- F4, F5, F6 were trivial minors; fixed in iteration 1.
- F7, F8, F9 are deferred (non-trivial test-structure refactor / new audit behavior) and will be handed off as a follow-up issue.
- F1 and F2 were reported by both reviewers; F3 by the architecture reviewer.
- Fixes are uncommitted at re-review time; delta baseline is commit `c752ad2`.
