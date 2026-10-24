# PAF-7 walkthrough — browser-automated verification

Reverified 2026-10-24 against a fresh production preview and real local Supabase. Browser automation drove visible controls; submission responses were not mocked. Command: `pnpm test:e2e e2e/matches-results.spec.ts e2e/matches-results-visual.spec.ts` — **24 passed**.

## Observed walkthrough

Journey: **assign two groups and submit only one pending result** — PASS.

Observed event `4c629817-f464-4b6c-a0c0-0deb6bc2aba6`; proposal `ef89c6a3-38c6-47f6-a983-a99ad6760f36`. Fixture creates eight accepted Playing participants, finalizes cutoff with production processor, then sets completed schedule (`2026-10-01T22:00:00Z`) in an isolated fixture transaction. Authenticated creator opens match detail and follows **Record result**.

| Step | Browser action / assertion | Observed result |
| --- | --- | --- |
| 1 | Select Group 2; change second Team A seat to third quartet member | Actual draft A: Management Player 4 + 6; B: Player 5 + 7. Four unique players |
| 2 | Select Group 1; perform same explicit team correction | A: Management Host + Player 2; B: Player 1 + Player 3. Eight distinct players across both groups |
| 3 | Confirm teams; enter completed sets 6–4 and 4–6; add unfinished 2–1 third set | DRAW preview; unfinished third set cannot decide result |
| 4 | Enter played date/time in UTC and Court 2; review | Actual teams, all three set facts, date/time and court shown |
| 5 | Open second creator browser context before first submission; prepare stale draft | Two independent authenticated editors; no request interception |
| 6 | Submit first draft only | PENDING · NOT CONFIRMED; Group 1 / Version 1; 48-hour countdown and absolute deadline |
| 7 | Submit stale draft | Typed conflict, version 1 retained, explicit reload control, submit removed; no silent retry |
| 8 | Read authorized proposal RPC; compare full official profile/rating rows and notifications; revisit detail | Exactly one pending proposal, Group 1 / version 1; 22 official rows unchanged (11 profiles + 11 ratings); roster/notifications unchanged |

Group 2 remains an independently corrected browser draft, deliberately not submitted. No League/standings/statistics store or surface exists; schema inventory confirmed no such tables. No fictitious standings feature introduced.

## Persisted proposal facts inspected

- Teams: A Host + Player 2; B Player 1 + Player 3. Same user IDs/order as explicit browser selection.
- Sets: `{position:1, team_a_games:6, team_b_games:4, completed:true}`, `{position:2, team_a_games:4, team_b_games:6, completed:true}`, `{position:3, team_a_games:2, team_b_games:1, completed:false}`.
- Classification `draw`; status `pending`; group `1`; version `1`; submitter name `Management Host`.
- Played local `2026-10-23 18:30:00`; offset `0`; UTC `2026-10-23T18:30:00+00:00`; court `Court 2`.
- Submitted `2026-10-24T13:58:02.425321+00:00`; deadline `2026-10-26T13:58:02.425321+00:00`, exactly 172800000ms / **48 hours** after submission, independent of scheduled/played clocks.
- `rating_effective: true` is competitive-Draw proposal metadata, **not an applied mutation**. Entire official rows value-equal before/after.

Artifacts: `test-results/matches-results-assign-two-cc1f7-mit-only-one-pending-result-chromium/manual-draw-review.png` and `manual-pending-match-detail.png`; `observed-proposal-facts` attachment and `PAF-7 observed walkthrough` console JSON. Reruns regenerate IDs/timestamps; names/assertions deterministic. Fixtures cleaned after suite. This is an automated browser walkthrough, not a claim of additional human/manual screen-reader testing.

## Other browser evidence

- **admin recovers submission when creator unavailable** — PASS. Same-community admin outside playing quartet uses detail entry, corrects teams, submits; persisted submitter is admin.
- **invalid score identifies set and team inline** — PASS. Completed 6–5 produces `set-error-1`, **Team B** invalid/described-by association; no proposal written.
- **friendly preview shows no rating effect** — PASS. No-rating/League copy, successful pending submission, official rows unchanged.
- **18** width/theme/locale variants PASS: 320/390/1280px × light/dark × en/pt-BR/es. Steps, two chips/team, corrected selections, sequential rows, completion states, both winners, Draw, Incomplete, Friendly, pending, conflict, no overflow, translated title/chrome clearance and ≥44px targets checked.

## Visual certification — all six pass

Authoritative full-route frames supersede old annotated state sheets. Corrected `alZmm` frame includes **48H**, deadline **25 Oct 2026, 18:30**, subtitle **Community match**, submitter **Thiago R.** Its fixture uses supported venue/location fields **PADEL INDOOR MADRID** / **Calle de Alcalá**, real display names and pinned real venue JPEG.

Pending detail shows compact clock/timer status cards; group/version/submitter/time/deadline metadata; actual-team chips; proposed score matrix; green **REVIEW PROPOSAL** CTA. CTA is disabled with translated accessible unavailable explanation: later epic owns review actions. No confirm/reject/auto-confirm transition added.

All six exact page dimensions and card bounds match. Pending status-card/team/recap/CTA inner bounds also exact. YIQ changed-pixel measurements: Draw **4.0823% / 4.5% budget**; WIN **3.2394% / 3.6%**; Incomplete **3.2032% / 3.6%**; Friendly **3.2347% / 3.6%**; invalid set **4.3381% / 4.7%**; pending **4.7975% / 5.2%**. Fixing overview punctuation removed 441 copy-difference pixels; provisional pending budget tightened from 5.3%. Raster budgets cover inspected glyph/icon edges and photo resampling only. No masks, cropping, stretching, self-baselines or widened existing budgets. Reference manifest/README record provenance and regional measurements.

Visual pending snapshot alone seeds submission/deadline **23 Oct 18:30 → 25 Oct 18:30**, freezes serialized SSR read clock/countdown and browser clock to submission instant. Functional walkthrough above remains live/unintercepted and independently verifies deadline arithmetic. Fixed snapshot clock does not alter production clocks or RPC/domain behavior.

## Regression / AC reconciliation

- Typecheck/lint/generated DB-type check PASS. Submitter-context migration changes JSON projection, not SQL signature; no generated-type drift.
- Scoped result/i18n/db-types/management capabilities/functions/provenance units: **254 tests / 12 files PASS**. Full unit retry: **1,263 tests / 109 files PASS**, unchanged coverage thresholds.
- Serialized result schema/scoring/submission + management protection/visibility/notifications: **40 tests / 6 files PASS**.
- Browser: **24 tests PASS**, four named journeys and all six visual references certified.
- AC1–AC3: quartet eligibility, actual-team correction, independent played-at facts covered by SQL/unit/browser readbacks.
- AC4–AC6: SQL/TS parity and illegal-set/Draw/Incomplete/Friendly previews; no official mutations.
- AC7: real stale-editor conflict; active version/48h receipt and persisted deadline assertions.
- AC8: set/team inline error, recursive locale copy/interpolation coverage, responsive/localized structural states and six approved full-frame comparisons PASS.
- Mandatory isolated `pnpm complete-check` executed **once**: DB types/build/knip/typecheck/lint/format PASS; test stage FAIL because `test/lint-staged.test.ts` could not read machine-local `~/.gitconfig` (1 failed suite, 108 passed, 1,255 tests passed; integration phase short-circuited); browser stage **236 passed / 6 failed**. No heavy jobs overlapped preview; no coverage threshold changed. Full test-stage retry uses process-only `GIT_CONFIG_GLOBAL=/dev/null`, not repository/test changes; full fresh-preview browser retry follows sequentially. Original complete-check failure remains reported, not relabeled green.
- Final sequential stage retries: `GIT_CONFIG_GLOBAL=/dev/null pnpm test` PASS (**1,263 units / 109 files**, configured coverage **100%**; **269 integrations / 37 files**). Full `pnpm test:e2e`: **240 passed / 2 failed** (legacy `tVzco` pixel composition; one fixture SQL deadlock). Final serial T07 + both-failure recheck: **25 passed / 1 failed**; T07 **24/24** and cancelled-tombstone responsive case PASS; only `tVzco` remains red. Its **22.4741%** difference exceeds unchanged **10.5%** budget because old started-match composition omits new legitimate Record result entry. Requires approved updated legacy composition; no tolerance widened or action hidden. Parallel fixture-DDL contention remains a reliability risk despite isolated retry passing. Overall unit **partial**, not full-QA green.

## Defects and adaptations

- Tokenized translated-title gutter prevents 320px pt-BR/es headings colliding with shared locale/theme controls.
- Full gate revealed the inherited direct result-entry link on upcoming matches shifted legacy detail compositions. Post-match entry now advertised only after server-projected `is_past`; creator/admin capability and direct-route/server authorization unchanged. Legitimate past-match entry remains available even when roster management is locked. Existing tokenized primary-link styling replaces the uncentered generic button style.
- Pending overview date uses an en/pt-BR/es interpolation template so English matches approved `Fri, 23 Oct` punctuation; punctuation differences are fixed, not charged to raster budget.
- Pending screenshot now requires successful hero decode; local fixture contexts grant Chromium loopback-network permission for real signed Storage images. Broken-image captures cannot certify.
- Ownership-scoped E2E cleanup removes proposal versions/proposals before event deletion and restores named immutability guards. No blanket guard weakening.
- Same-community admin intentionally receives authorized result-team identities; public roster remains privacy-safe. Submitter reader retains nullable display-name fallback.
- PAF-6 opaque source digest refreshed after approved design correction only after all **19** frames freshly re-exported at 1× matched original PNG hashes; images/budgets untouched.
- Existing photo-publication fixture guard preserved; schema probes use trigger-valid transactional Storage metadata.
- Nested testing-agent delegation unavailable (depth limit); browser work executed directly. No commits created.

## Approved started-entry closure

Approved `iXRPp` (`c24ac8a`) replaces historical `tVzco` as the started-unavailable certification target. Existing creator/admin **Record result** link and observed walkthrough actions are unchanged; no new walkthrough flow required. Exact result-ready line boxes and card gaps now match the approved successor. Source export, 3.1676% measured / 3.6% budget and inherited runtime-clock mask are documented in `e2e/references/paf-7/README.md`.

Parallel fixture contention fixed test-only: shared transaction advisory guard before fixture DO work, plus parent-first cleanup table locks. Retained-backend integration proves blocking occurs before relation locks and release on rollback. Live submission race tests and browser RPCs stay concurrent; no retries or worker reduction. Closure scoped validation: **267 units / 14 files**, **42 serialized integrations / 7 files** pass. Full browser suite **242/242 PASS with 5 workers**, twice including complete-check, with previously deadlocking fixture and all seven current reference targets passing.

Closure complete-check invoked once with sandbox Git override: DB types/build/knip/typecheck/lint/format/E2E PASS; **test stage FAIL** despite **1,270/1,270 units (110 files)** and 100% configured coverage. Integrations: **268 passed / 3 failed** — community settings-size timeout, community invitation-expiry assertion, cancellation timeout. Both failed integration files passed **31/31 in 41.08s** on unchanged-source `caffeinate -is` retry. Initial timeouts reported ~10/~16-minute test durations despite 60s/15s limits; interruption suspected but cause unproven. No retained fixture backend and host/DB clocks aligned after run. Original gate stays red; no second complete-check, no thresholds/timeouts raised. Overall closure remains partial solely on unexplained full-integration timing/expiry failures, not references or browser deadlock. Full detail/log paths in reference README.
