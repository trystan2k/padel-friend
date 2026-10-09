# PAF-30 Findings Ledger

| id  | severity | location                                                  | title                                                                                          | status   | owner                     | iteration |
| --- | -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | ------------------------- | --------- |
| F1  | major    | src/routes/onboarding_.community.tsx:48                   | Query-keyed remount breaks live-search focus and draft/status continuity                       | fixed    | implementation-specialist | 3         |
| F2  | major    | src/features/community/CommunityOnboarding.tsx:67         | `joinFailed` blocks retry; enabled button no-ops                                               | fixed    | implementation-specialist | 1         |
| F3  | minor    | src/features/community/community-onboarding.styles.ts:49  | Search styling differs from Pencil (border/radius/padding/14px)                                | fixed    | implementation-specialist | 1         |
| F4  | minor    | src/features/community/community-onboarding.styles.ts:78  | Card actions inherit borders; request label inherits green                                     | fixed    | implementation-specialist | 1         |
| F5  | minor    | src/features/community/community-onboarding.styles.ts:105 | Visibility option fill and typography weights differ from `JO4DC`                              | fixed    | implementation-specialist | 1         |
| F11 | major    | src/features/community/CommunityOnboarding.tsx:60         | Pagination failure survives a successful same-query retry and blocks loadMore                  | fixed    | implementation-specialist | 2         |
| F12 | major    | src/routes/onboarding_.community.tsx:46                   | Successful creation survives browser Back / create re-entry, hiding a fresh form               | fixed    | implementation-specialist | 2         |
| F13 | major    | src/features/community/CommunityOnboarding.tsx:52         | Untracked create navigation breaks browser Back query restoration (pending-edit create → Back) | fixed    | implementation-specialist | 3         |
| F6  | minor    | e2e/community-onboarding.spec.ts:382                      | SSR locale check observes hydrated DOM, not raw SSR HTML                                       | deferred | deferred                  | 1         |
| F7  | minor    | e2e/community-onboarding.spec.ts:150                      | Visual comparator lacks image-dimension validation                                             | deferred | deferred                  | 1         |
| F8  | minor    | src/features/community/CommunityOnboarding.tsx:289        | No translated pending feedback for discovery search/retry                                      | deferred | deferred                  | 1         |
| F9  | minor    | src/features/community/CommunityOnboarding.tsx:218        | Optional-field labels disappear after entry                                                    | deferred | deferred                  | 1         |
| F10 | minor    | e2e/community-onboarding.spec.ts:322                      | Masked card content lacks exact structural probes                                              | deferred | deferred                  | 1         |

## Notes

- All critical/major findings fixed across 3 fix iterations (F1, F2, F11, F12, F13); F3–F5 visual-fidelity minors fixed.
- The third iteration fixed the F13 history-navigation edge case (user-approved cap exception); both code and architecture delta reviews confirmed it with no regressions.
- F6–F10 deferred; handed off as a follow-up issue.
- The card adaptation (omitting member counts / skill ranges) and the create-screen tolerance were **accepted** by the UX/UI reviewer (not findings).
- Visual tolerances tightened across iterations (discovery 3.67→3.57%, create full 11.79→11.77%, create upper 7.40→7.37%).
