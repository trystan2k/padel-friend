# PAF-31 PR2 Findings Ledger (admin UI)

| id  | severity | location                                                                        | title                                                                                  | status   | owner                     | iteration |
| --- | -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- | ------------------------- | --------- |
| F1  | major    | src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx:19 | Member detail searches the first roster page instead of fetching the membership by ID  | fixed    | implementation-specialist | 1         |
| F2  | major    | src/features/community/CommunityAdmin.tsx:486                                   | Members/requests/venues pagination: initial active-roster Load More returns nothing    | fixed    | implementation-specialist | 2         |
| F3  | major    | src/features/community/CommunityAdmin.tsx:322                                   | Search/filter changes drop the latest request and leave stale narrowed results         | fixed    | implementation-specialist | 1         |
| F4  | major    | src/features/community/CommunityAdmin.tsx:211                                   | Reactivation ignores the returned replacement membership ID                            | fixed    | implementation-specialist | 1         |
| F5  | major    | src/features/community/CommunityAdmin.tsx:51                                    | Runtime-default timezone breaks Worker-SSR vs browser date parity                      | fixed    | implementation-specialist | 1         |
| F6  | major    | src/routes/_protected.community.$communityId.admin.index.tsx:3                  | No navigation entry into the admin screens                                             | fixed    | implementation-specialist | 1         |
| F7  | major    | src/features/community/CommunityAdmin.tsx:144                                   | Settings draft survives a community-param change (cross-community overwrite)           | fixed    | implementation-specialist | 1         |
| F8  | major    | e2e/community-admin.spec.ts:565                                                 | Venue visual masks cover static structure; venue Y positions not source-relative       | fixed    | implementation-specialist | 2         |
| F9  | major    | src/features/community/CommunityAdmin.tsx:580                                   | Requests screen title typography still Manrope 16 bold (Pencil Inter 12 semibold)      | fixed    | implementation-specialist | 2         |
| F10 | major    | src/features/community/CommunityAdmin.tsx:755                                   | Audit labels every actor as "Community admin" (member events mislabeled)               | fixed    | implementation-specialist | 1         |
| F11 | minor    | src/features/community/community-admin.styles.ts:232                            | Link hit-area width not ≥44px for short names                                          | fixed    | implementation-specialist | 2         |
| F12 | minor    | src/features/community/community-admin.styles.ts:342                            | Raw untokenized navigation shadow (Pencil has none)                                    | fixed    | implementation-specialist | 1         |
| F23 | major    | src/features/community/CommunityAdmin.tsx:578                                   | Mutation invalidation refreshes only the first page; appended pages go stale/duplicate | fixed    | implementation-specialist | 2         |
| F13 | minor    | src/features/community/CommunityAdmin.tsx:226                                   | Confirmation focus not transferred/restored                                            | deferred | deferred                  | 1         |
| F14 | minor    | src/features/community/CommunityAdmin.tsx:94                                    | Loader-error state lacks retry/safe exit                                               | deferred | deferred                  | 1         |
| F15 | minor    | e2e/community-admin.spec.ts:394                                                 | 320px/locale coverage only partial across six screens                                  | deferred | deferred                  | 1         |
| F16 | minor    | src/features/community/community-admin.functions.ts:75                          | `getCommunityAdminContext` inline validator duplicates shared conventions              | deferred | deferred                  | 1         |
| F17 | nit      | src/features/community/community-admin.styles.ts:55                             | Icon line-height token exception undocumented                                          | deferred | deferred                  | 1         |
| F18 | minor    | e2e/community-admin.spec.ts:377                                                 | Denial assertions don't prove confidential-payload absence                             | deferred | deferred                  | 1         |
| F19 | minor    | src/routes/_protected.community.$communityId.admin.members.tsx:29               | Members layout re-loads roster and uses pathname suffix for index                      | deferred | deferred                  | 1         |
| F20 | minor    | src/features/community/CommunityAdmin.tsx:117                                   | Six screens couple unrelated state in one component                                    | deferred | deferred                  | 1         |
| F21 | minor    | test/community.admin-extraction.test.ts:15                                      | F10 can inspect a stale build standalone                                               | deferred | deferred                  | 1         |
| F22 | minor    | test/community.admin-routes.test.ts:24                                          | Source-string assertions can't prove parent/guard relationships                        | deferred | deferred                  | 1         |

## Notes

- All critical/major findings fixed across 2 fix iterations (F1–F12, F23). Both code and UX/UI delta reviews confirm no regressions and no new critical/major.
- F13–F22 deferred (UX polish, test hardening, component split) → follow-up issue.
- F1's `get_community_member_by_id` migration makes PR2 not strictly UI-only (backend handoff correction); PR1 contracts unchanged.
- All six Pencil screens accept-with-notes; caps not widened; RgqPq residual improved 24,671→14,788 after the geometry fix.
- Approved honest omissions are NOT findings.
