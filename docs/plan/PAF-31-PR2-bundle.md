# PAF-31 PR2 Context Bundle — admin UI (slices C+D)

## Scope

- **Issue:** PAF-31 — PAF-2.6 — Admin governance (UI half)
- **Branch:** `feature/PAF-31-admin-governance-ui` (STACKED on `origin/feature/PAF-31-admin-governance` @ `5547f3b`; PR targets the PR1 branch, not `main`)
- **Commit:** `f9103c8` — `feat: add community administration screens`
- **Plan:** `docs/plan/Plan PAF-31 PAF-2.6 — Admin governance requests, membership, roles, settings, venues, audit.md` (steps 2, 6, 7)

## Acceptance criteria (UI half)

1/4/5/6 UI surfaces: approve/deny requests, member management (invite API exists; invite form deferred), roles, settings, saved venues, member search, audit view — Admin-only, members blocked. 7: every admin action/read rejects member/nonmember (routes + server). Visual gates for the six Pencil screens.

## Approved adaptations (honest — no fabricated data)

- Omitted: request messages/notifications, member match counts, settings defaults (timezone/currency/league-enable), league-result audit events, venue photo upload. Invite form deferred (no invitee discovery).
- Audit uses 3-row paging; settings puts supported name/city/description in a disclosure, separate from visibility/join controls.

## Changed files (30)

- NEW `src/features/community/CommunityAdmin.tsx`, `community-admin.styles.ts`; CHANGED `community-admin.functions.ts` (+`getCommunityAdminContext`).
- NEW 9 routes `src/routes/_protected.community.$communityId.admin*.tsx` (guard → per-view `is_community_admin`).
- CHANGED `src/locales/{en,es,pt-BR}/translation.json` (+125 each).
- NEW `test/community.admin-ui.test.tsx`, `community.admin-routes.test.ts`, `community.admin-extraction.test.ts` (F10).
- NEW `e2e/community-admin.spec.ts` + 6 baselines + 6 Pencil references (`e2e/references/paf-31/*.png`).

`git diff --shortstat origin/feature/PAF-31-admin-governance..HEAD` → `30 files changed, 2492 insertions(+)` (PNGs binary).

## Full diff

```
git diff origin/feature/PAF-31-admin-governance..HEAD
```

Read `CommunityAdmin.tsx`, `community-admin.styles.ts`, and the 9 route files directly.

## Fast-gate / visual result (green)

- `pnpm build` ✅; F10: production bundle asserts **six distinct compiled transport IDs** for the membership endpoints (fails if reverted to a factory).
- `pnpm test` ✅ 340 tests (36 files); `test/community.admin.integration.test.ts` 11 tests (ran).
- `pnpm test:e2e` ✅ 52 passed.
- Visual diffs (pixel channel diff >24; masks cover unsupported reference content + fixture values; exact ±1px layout probes active):
  - RgqPq requests 20,254 / cap 21,000
  - wFqGR members 11,588 / 18,000
  - jQDkx member controls 17,167 / 18,000
  - N18Mu4 settings 18,444 / 19,000
  - A5Vio venues 16,144 / 18,000
  - E5CS5K audit 17,086 / 18,000

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/routes`, `src/features`, config changed.
- `ux-ui-reviewer-specialist` — REQUIRED (UI files changed).

## Notes for reviewers

- The self-reported `getCommunityAdminContext` uses an inline validator; check it against the shared validator conventions.
- The visual caps are large; masks are declared to cover only unsupported reference content and fixture-dependent values — the UX/UI reviewer must judge whether masks/caps hide structural defects or whether the adaptation is visually legitimate.
- The invite form is intentionally absent; F10 (compiled endpoint extraction) is verified here.
- Honest omissions (counts, messages, defaults, league events, photos) are approved decisions, not defects.
