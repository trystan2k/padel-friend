# PAF-5 Findings Ledger

Single source of truth for findings raised during the PAF-5 delivery. Rows are appended, never rewritten. `status` is one of `open`, `fixed`, `deferred`. `owner` is the agent that will fix it or `deferred`.

| id  | severity | location                                                    | title                                                                                                                                                                        | status | owner                     | iteration |
| --- | -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------- | --------- |
| F1  | major    | docs/design/padel-friend.pen                               | Missing Pencil frames for 8 registration states (direct-join CTA, requester pending/approved/rejected/expired, capacity full, prospective-registrant closed CTA, roster guest badge) | fixed  | designer (user)           | 1         |
| F2  | minor    | src/features/notifications/NotificationDetailPage.tsx      | Every available match notification target rendered the invitation heading, so new registration/cutoff kinds would be mislabeled                                            | fixed  | implementation (TS layer) | 1         |
| F3  | minor    | src/features/matches/ (match-model, detail projections)     | Registration count/projection semantics were duplicated across detail, list, badge and notification context; they must agree on active-accepted-only                      | fixed  | implementation (SQL layer) | 1         |
| F4  | minor    | docs/design/padel-friend.pen:fo8Zn, SYMLa, tYXlh            | Venue photo block existed (354x144) but its reference text content was missing: venue label, venue name, and location/map line present in JLqMT/eYIgj/nNzWb              | fixed  | designer (user)           | 1         |
| F5  | minor    | docs/design/padel-friend.pen:fo8Zn, xC04T                   | Guest pill measured 106x23 vs 106x25 in CLn9x; explicit line-height 1.1 changed pill shape although fill/font/padding/radius matched                                      | fixed  | designer (user)           | 1         |
| F6  | nit      | docs/design/padel-friend.pen:fo8Zn:hskCT                    | Node named "Daniela Pires request type label" sat on Javier Soto's reserve row; wrong layer name for implementation probing                                             | fixed  | designer (user)           | 1         |
| F7  | deferred | docs/design/padel-friend.pen:fo8Zn, SYMLa, tYXlh, xC04T     | Reported "rating content" (COMPETITIVE / GLOBAL RATING ONLY badges, numeric player levels) is NOT a defect: these strings were supplied by the brief and mirror JLqMT/eYIgj/nNzWb; brief rule 11 meant rating-change and league data only | deferred | n/a                    | 1         |
| F8  | deferred | docs/design/padel-friend.pen:Za6r4, xC04T                   | New frames duplicate roster/status structure instead of reusing shared components; no component extraction for roster rows or status badges                                    | deferred | n/a                      | 1         |
| F9  | major    | e2e/matches-visual.spec.ts:1330                             | Trusted E2E fixture insert omitted `accepted_order`, `participation_status` and `registration_source`, and never advanced `match_event_registration_state.next_accepted_ordinal`; the new anchor CHECK made it invalid and the stale ordinal would have collided with PAF-5.2 allocation | fixed  | testing-automation-specialist | 1      |
| F10 | minor    | supabase/migrations (match_registration_read policy)        | The unchanged T04 read policy let a community Admin read pending registration rows of their community's events; approval authority belongs to the creator only            | fixed  | implementation (SQL layer)  | 1         |
| F11 | minor    | supabase/migrations/20261017173426_match_registration_domain.sql | The migration forced `accepted_order` NOT NULL while the lifecycle-anchor CHECK requires it NULL for non-accepted rows, which would have made any pending row impossible | fixed  | orchestrator (direct)     | 1         |
| F12 | minor    | test/matches.publication.integration.test.ts:637            | Pre-existing cross-suite leak: a forced match-notification failure trigger fires in a shared backend and fails that suite when run with others; passes in isolation. Documented in the PAF-4 plan. Also manifests as `FORCED_MATCH_NOTIFICATION_FAILURE` in `matches.discovery` and `matches.registration.visibility` during the full gate | deferred | n/a                   | 1         |
| F13 | nit      | docs/design/padel-friend.pen:qNVpA, Cpd7L                   | Bottom-navigation icons diverge from the sibling frames (Profile renders `shield-check` instead of `user-round`; Cpd7L renders `calendar-days` for Home instead of `house`). No implementation impact: the bottom nav is shared chrome from earlier deliveries | deferred | n/a                    | 1         |
| F14 | minor    | supabase/migrations (match_event_registration_state / _attempts) | Supabase CLI emits an `rls_disabled` advisory for the two internal tables. Verified FALSE POSITIVE: all privileges are revoked from `public`/`anon`/`authenticated` and client reads/writes fail with `42501` | deferred | n/a                    | 1         |
| F15 | major    | test/matches.registration.schema.integration.test.ts:406    | The backfill oracle asserted the `(creator-first, accepted_at, id)` correlation across the WHOLE database, so it failed on any directly-inserted accepted rows. Root cause: the invariant is only meaningful within the event under test — `accepted_order` is the authoritative ordinal and `accepted_at` is audit-only, with no schema-level correlation. Fixed by scoping the scan to the suite's own fixture event plus a non-vacuity guard; the invariant itself was NOT weakened | fixed  | implementation (fix loop)  | 1         |
| F16 | major    | e2e/matches.spec.ts:770 / MatchRegistrationPanel.tsx        | Real UX defect: the new registration panel re-rendered the identical invitation paragraph inside the "Your place in this match" region, so `matches.detail.invitationInfo` appeared twice on one screen. Fixed in the product (the panel now renders nothing for an invited caller with no registration row); the previously loosened strict locator was restored and a regression test added | fixed  | implementation (fix loop)  | 1         |
| F17 | minor    | src/features/matches/MatchRegistrationPanel.tsx             | The accepted-state "View group" link targets the same route it is rendered on (a self-link). Design-approved in frame Za6r4, so left as-is pending review | open   | n/a                       | 1         |
| F18 | minor    | e2e/matches-registration-visual.spec.ts fixtures            | The visual-spec fixture events (`Registration/Roster/Capacity/Cutoff Visual Arena`) and their notifications are created by direct inserts outside the `global-setup.ts` prune, so they leak between runs and can trip other suites' whole-DB assertions | open   | testing-automation-specialist | 1         |
| F19 | minor    | supabase/seed.sql / local stack                             | Local-only: the pg_cron cutoff job is deliberately unscheduled by the seed so a live 1-minute job cannot mutate fixtures mid-suite. Consequence: the unattended cadence is never exercised locally (the processor and batch catch-up are tested by direct invocation); hosted keeps the migration-created job | deferred | n/a                    | 1         |

## Review-phase findings (iteration 2)

Merged from the code, architecture and UX/UI reviews. Severity decides blocking: critical/major must be fixed.

| id  | severity | location | title | status | owner | iteration |
| --- | -------- | -------- | ----- | ------ | ----- | --------- |
| F20 | critical | supabase/migrations/20261017173426_match_registration_domain.sql:18 | The backfill UPDATEs ran BEFORE the old `match_registration_immutable` trigger was dropped, so on any populated database (hosted/production) the migration aborted with `23514`. Local `db:reset` starts empty, so it went undetected. Fixed by dropping the trigger first; reproduced the real abort on a populated predecessor DB, then proved the fixed order applies | fixed | bug-fixer-specialist | 2 |
| F21 | major | supabase/migrations/20261017200000_match_registration_fifo.sql:377 | `decide_match_registration` identified the requester by user, not by attempt, so after a rejection and re-application a stale decision could resolve the NEW attempt unreviewed. Now bound to the immutable attempt id, re-verified under lock; the creator queue exposes `requests[].attempt_id` | fixed | bug-fixer-specialist | 2 |
| F22 | major | src/features/matches/use-match-registration.ts:156 | Unbounded `setTimeout` for the cutoff boundary overflowed browser timers beyond ~24.8 days, closing registration immediately. Now polls in bounded segments and only marks reached after checking the real deadline | fixed | bug-fixer-specialist | 2 |
| F23 | major | supabase/migrations/20261017200000_match_registration_fifo.sql:704 | The caller's own-registration read returned the STORED `pending` lifecycle after cutoff. Now projects the DB-time effective expiry, write-free, mirroring the roster's cutoff-aware status | fixed | bug-fixer-specialist | 2 |
| F24 | major | supabase/migrations/20261017220000_match_registration_cutoff_scheduler.sql:39 | Batch failures were discarded, so cron reported success and the documented observability did not hold (empirically proven: `return_message` was just `1 row`). Now persists per-event failure count/sqlstate/message on the state row; `INITIAL_SETUP.md` updated to match | fixed | bug-fixer-specialist | 2 |
| F25 | major | supabase/migrations/20261017210000_match_registration_cutoff.sql:345 | Oldest-first with a fixed LIMIT let 25 failing/lock-skipped events permanently starve later due events. Selection is now fair via an attempt cursor, with a poisoned-prefix test | fixed | implementation-specialist | 2 |
| F26 | major | src/routes/_protected.matches.$eventId.tsx:92 | A failed registration read was silently swallowed, so the panel and its refresh listeners vanished with no error or retry. Now forwarded and rendered as an accessible retry region independent of the data | fixed | bug-fixer-specialist | 2 |
| F27 | major | src/features/matches/MatchRegistrationPanel.tsx:408 | Direct registrations and the creator's own slot rendered the APPROVAL badge and "Approved at …" copy with a null `approved_at`. Now three distinct variants (creator / approved / direct join), never rendering a timestamp that does not exist | fixed | implementation-specialist | 2 |
| F28 | major | src/features/matches/MatchRegistrationPanel.tsx:190 | Action error codes were interpolated into camelCase translation keys, rendering raw keys, and `event_not_found` had no copy. Now one exhaustive code→key map shared by the panel and the queue, with copy in all three locales | fixed | implementation-specialist | 2 |
| F29 | major | src/features/notifications/NotificationDetailPage.tsx:319 | The reserve notification always claimed present-tense reserve placement, even for promoted or not-playing players, clamping promoted players to `#1`. Now gated on current participation with honest historical wording | fixed | bug-fixer-specialist | 2 |
| F30 | minor | supabase/migrations/20261017173426_match_registration_domain.sql:18 | The blanket `reserve` backfill diverged from the derived roster, so the first reconciliation on an upgraded database emitted false historical promotion and quartet-complete alerts. Backfill now derives playing/reserve (cutoff-aware), and the first reconcile is a verified no-op | fixed | bug-fixer-specialist | 2 |
| F31 | minor | src/features/matches/MatchRequestQueue.tsx:135 | Every out-of-range request was described as "above your range", misdescribing below-range and unrated members, and the fallback could call a member a nonmember. Now distinct above-range / below-range / unrated / member contexts | fixed | implementation-specialist | 2 |
| F32 | minor | e2e/matches.spec.ts:658 | The page-wide zero-button assertion collided with the pre-existing "Load more" pagination control once the shared listing exceeded one page. Now scoped by exact localized name so every other button still fails the contract | fixed | testing-automation-specialist | 2 |
| F33 | minor | test/matches.registration.schema.integration.test.ts:432 | The backfill test inserted already-correct ordinals instead of executing the real backfill. Partially addressed: a new suite executes the actual migration statements in file order against a rolled-back populated fixture; full `supabase migration up` upgrade coverage in CI is still missing | open | testing-automation-specialist | 2 |
| F34 | minor | e2e fixtures (matches-registration visual/journeys) | The E2E fixtures previously asserted APPROVED wording for rows they seeded as direct joins, so the visual gate was validating the F27 defect. Fixtures now genuinely seed `approved_at = accepted_at` where the frames depict the approved state, and direct joins assert the joined/created copy | fixed | testing-automation-specialist | 2 |

## Unit log

| Unit    | Linear | Status      | Commit    | Fast gate                                                                 |
| ------- | ------ | ----------- | --------- | ------------------------------------------------------------------------- |
| PAF-5.1 | PAF-78 | committed   | `2c0c0ce` | typecheck PASS, lint PASS, 2 new suites 7/7 PASS, 8 touched suites + 11 regression suites PASS |
| PAF-5.2 | PAF-79 | committed   | `54ce88c` | typecheck PASS, lint PASS, 10 suites 54/54 PASS, concurrency deterministic over 10 runs, F10 assertion repaired |
| PAF-5.3 | PAF-80 | committed   | `f9ed22d` | SQL: 12 suites 56 tests PASS, forced-notification rollback proven, N=1..13 oracle verified. Tests: 24 files 107/107 PASS, 5 proven-overlap races x 10 consecutive runs deterministic, atomic rollback proven, 0 leaked blockers |
| PAF-5.4 | PAF-81 | committed   | `0ebe502` | typecheck PASS, lint PASS, cutoff suite 15/15 across 5 consecutive runs, atomic rollback + catch-up + effective-status-on-read proven |
| PAF-5.5 | PAF-82 | committed   | `6e7668f` | typecheck PASS, lint PASS, 43 files 306 tests PASS, roster read RPC added and gated by event readability |
| PAF-5.6 | PAF-83 | committed   | `f6f919b` | functional E2E 12/12 (twice), visual gate 7/7 + PAF-4 visual 11/11 = 18/18 combined, references exported with real digests |
| Fix loop (iteration 1) | — | committed | pending | knip PASS, typecheck PASS, lint PASS, E2E matches.spec 10/10, E2E registration 12/12 incl. the 3 previously-unexecuted journeys, visual 7/7 |

## Authoritative full-gate result (run once, before the approval gate)

| Stage | Result |
| ----- | ------ |
| db:types:check | PASS |
| build | PASS |
| knip | FAIL → fixed in the fix loop (F15/F17 dead export) |
| typecheck | PASS |
| lint | PASS |
| format:check | PASS |
| test | FAIL — 41 failures / 12 files, dominated by environmental causes: local GoTrue `AuthRetryableFetchError 500` during parallel signup seeding (94 workers), Postgres `57014` statement timeouts in community suites, the F12 forced-failure trigger leak, plus F15's mis-scoped oracle (fixed) |
| test:e2e | FAIL — 3 failed / 3 did not run / 133 passed: one transient local Postgres connection timeout that aborted a serial block (the 3 dependent journeys were later re-run and pass), plus F16 (fixed) and the intentional link-count contract change (probe updated) |

Honest status: the full gate did NOT pass on its first run. The delivery-caused failures are fixed in the fix loop; the remainder are pre-existing/environmental and are recorded above rather than hidden. A second full-gate invocation is a user decision.

## Design frame registry (PAF-5 visual source of truth)

New frames, verified at 101 top-level frames, ids stable, existing assets untouched:

| Frame id | Frame name                                              | Used by  |
| -------- | ------------------------------------------------------- | -------- |
| fo8Zn    | Match detail — direct join                              | PAF-5.5  |
| SYMLa    | Match detail — registration full                        | PAF-5.5  |
| tYXlh    | Match detail — registration closed                      | PAF-5.5  |
| Za6r4    | Match requests — requester states                       | PAF-5.5  |
| xC04T    | Match roster — participation states                     | PAF-5.5  |
| Z0gRd    | Notifications — registration and cutoff                 | PAF-5.2, PAF-5.4, PAF-5.5 |
| qNVpA    | Notifications — quartet and playing states              | PAF-5.3, PAF-5.5 |
| Cpd7L    | Match participation — quartet filled                    | PAF-5.3, PAF-5.5 |

Pre-existing references reused: JLqMT, eYIgj, nNzWb (detail structure), CLn9x (organizer queue, approve/decline, guest pill), t1ywa (participation status variants; its promotion card documents the T06 withdrawal trigger, so PAF-5 uses Cpd7L for the quartet-completion wording), uiRqp (cutoff exclusion), dmvWu (post-cutoff unavailable actions), ausNa (stale/offline), n6zFq (shared states).
