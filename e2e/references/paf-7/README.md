# T07 result route certification

Current: **seven references certified; full parallel browser suite 242/242 green twice**. Closure `complete-check` still red in integration stage; three timing/expiry failures passed a scoped 31-test retry. Overall task remains partial until a green complete gate. Details at end.

Source: `docs/design/padel-friend.pen`. Five route references exported from approved design commit `26ffbbc`; corrected `alZmm` exported read-only through Pencil MCP after sample-data correction `9ed58b1`. Approved started-entry successor `iXRPp` from `c24ac8a` exported read-only on 2026-10-24. `manifest.json` pins current opaque source bytes and uncropped 2× PNGs. Original six route PNGs/budgets unchanged during closure. Old state-sheet exports remain component-reference documentation only.

## Final measurements

390px/light/en, fresh production preview. Reference normalized only by documented 2× export scale; neither image stretched nor cropped. Original six references are unmasked; `iXRPp` carries forward only the previously documented runtime-clock date block mask (details below). Comparator counts pixels above YIQ distance threshold 0.1. Budget means changed-pixel fraction, not color-distance threshold.

| Route frame                    | Actual and reference CSS size | Measured difference | Budget | Result |
| ------------------------------ | ----------------------------- | ------------------- | ------ | ------ |
| `XySt5` score/Draw             | 390×1037                      | 4.0823%             | 4.5%   | Pass   |
| `GPo9z` review WIN 2–1         | 390×1103                      | 3.2394%             | 3.6%   | Pass   |
| `c0wbmu` review INCOMPLETE     | 390×1103                      | 3.2032%             | 3.6%   | Pass   |
| `NZk5H` review friendly 2–1    | 390×1118                      | 3.2347%             | 3.6%   | Pass   |
| `wsXWA` invalid Set 1 / Team B | 390×946                       | 4.3381%             | 4.7%   | Pass   |
| `alZmm` pending detail         | 390×1042                      | 4.7975%             | 5.2%   | Pass   |
| `iXRPp` started + record entry | 390×1465                      | 3.1676%             | 3.6%   | Pass   |

Five original measurements reverified unchanged. Pending measured identically on repeated fresh previews after fixture reconciliation. All budgets follow image inspection; residuals concentrate on Inter/Manrope glyph edges/weight rasterization, glyph-derived pill widths and icon contours. Semantic colors, fonts, weights, sizes, line boxes and card geometry checked independently. Actual screenshots never become reference baselines. No existing budget widened.

### Pending measurement basis

`alZmm`: **19,496 / 406,380 pixels = 4.79748019%**, identical across two final fresh previews. Budget **5.2%**, headroom **0.40251981 percentage points**, comparable to the other five measured margins. Fixing English date punctuation removed 441 copy-difference pixels; provisional 5.3% budget tightened, never widened. Unmasked regional changed-pixel counts:

| CSS y interval | Region                       | Changed pixels |
| -------------- | ---------------------------- | -------------- |
| 0–72           | Header                       | 1,316          |
| 72–216         | Hero/photo and overlay copy  | 1,705          |
| 216–326        | Overview                     | 2,322          |
| 326–544        | Pending cards and provenance | 7,827          |
| 544–758        | Actual teams                 | 1,817          |
| 758–972        | Proposed scores and action   | 3,109          |
| 972–1042       | Navigation                   | 1,400          |

The same pinned venue JPEG is uploaded to local Storage and rendered through its real signed URL; residual photo differences come from 2× Pencil vs 1× Chromium resampling. Hero is decoded before capture. Chromium's local-network permission is explicitly granted in fixture contexts; broken-image pixels cannot pass capture readiness. Remaining differences are text/emoji and small icon rasterization, not missing copy, altered typography settings, spacing or geometry.

Exact record/review card probes: teams `(18,109,354,202)`, scores `(18,323,354,207)` (invalid: height 246), details/recap `(18,542,354,202/268)` (invalid: y581), outcome `(18,756/822,354,145/160)` where present. Pending hero/overview/proposal: `(18,72,354,144)`, `(18,228,354,86)`, `(18,326,354,636)`. Pending inner status cards: `(18,354,354,66)`, `(18,428,354,66)`; teams `(18,544,354,202)`; recap `(18,758,354,148)`; CTA `(18,918,354,44)`. Bounds in CSS pixels. Structural/copy mismatches are never authorized by raster budgets.

## Corrected pending fixture

- Real authorized actor display names: Thiago R., Ana M., Pedro L., Carlos F. Community `Padel Friends`; `community_open` projects `Community match` as corrected design specifies.
- Real supported event fields: venue `PADEL INDOOR MADRID`; `court_notes` location `Calle de Alcalá`; existing signed venue JPEG; decorative pin and `Open map ↗` link. No invented address column or fabricated visibility.
- Real proposal submitted through browser, then isolated fixture transaction seeds snapshot submission **23 Oct 2026 18:30 UTC** and deadline **25 Oct 2026 18:30 UTC**, exactly 48 hours apart. Teams/sets/classification/submitter remain real stored facts.
- Visual snapshot only: SSR document interception fixes serialized `as_of` and corresponding rendered countdown to **23 Oct 18:30**, and Playwright fixes browser clock to same instant. This models the instant of submission, not today's live countdown. No production clock, RPC implementation or domain rule changed. Functional journeys use live, unintercepted responses and independently prove deadline = submission + 48h.
- REVIEW PROPOSAL keeps design's green 44px CTA but remains disabled with translated accessible explanation: review workflow belongs to later epic, not implemented here.

## Functional and walkthrough evidence

Final isolated scoped browser command: `pnpm test:e2e e2e/matches-results.spec.ts e2e/matches-results-visual.spec.ts` — **24 passed**: four named journeys, immutable provenance, six full-frame comparisons and all **18** width × theme × locale structural variants. Overflow, title/chrome separation and ≥44px controls pass; translated pills wrap at narrow widths.

Reverified observed eight-player walkthrough, event `4c629817-f464-4b6c-a0c0-0deb6bc2aba6`:

- Actual group-one teams Host + Player 2 versus Player 1 + Player 3; independently corrected group two draft; only group one submitted.
- Stored 6–4 COMPLETE / 4–6 COMPLETE / 2–1 IN PROGRESS → **draw**, pending version **1**. Group two has no proposal.
- Played local `2026-10-23 18:30:00`, offset **0**, UTC `2026-10-23T18:30:00Z`, court **Court 2**. Submitted `2026-10-24T13:58:02.425321Z`; deadline `2026-10-26T13:58:02.425321Z`, exactly 48 hours later and independent of played time.
- Stale editor rejected; **22 official profile/rating rows unchanged**, roster unchanged, notifications unchanged. No League/standings/statistics tables exist. No confirmation/rejection/rating or League writes implemented.
- Browser-automated walkthrough, not additional human/manual screen-reader verification. Details: `docs/plan/PAF-7-manual-walkthrough.md`.

Scoped validation: typecheck/lint/knip/format/db-types check pass; **254 units / 12 files** and **40 serialized integrations / 6 files** pass. Full unit retry with process-only `GIT_CONFIG_GLOBAL=/dev/null`: **1,263 tests / 109 files pass**. Mandatory isolated `pnpm complete-check` initially failed test startup on inaccessible `~/.gitconfig` and six legacy browser assertions; original failure is not relabeled green. Final stage-retry results recorded below.

PAF-6 provenance refreshed after all **19** original frames were freshly re-exported at 1× and SHA-256 matched byte-for-byte; existing PNGs/budgets unchanged.

## Previous attempt — superseded by closure below

`pnpm complete-check` executed **once**, isolated:

| Stage          | Result                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| db:types:check | Pass                                                                                                                  |
| build          | Pass                                                                                                                  |
| knip           | Pass                                                                                                                  |
| typecheck      | Pass                                                                                                                  |
| lint           | Pass                                                                                                                  |
| format:check   | Pass                                                                                                                  |
| test           | Fail: machine-local `~/.gitconfig` inaccessible; 108 unit files / 1,255 tests passed; integration phase did not start |
| test:e2e       | Fail: 236 passed / 6 failed; inherited entry shifted legacy upcoming/started layouts and changed upcoming link count  |

After upcoming-entry/date-copy fixes, stage retries ran sequentially, no overlapping build/preview jobs:

- `GIT_CONFIG_GLOBAL=/dev/null pnpm test`: **Pass**, **1,263 units / 109 files**, configured coverage **100%**; **269 serialized integrations / 37 files**. No permanent Git configuration or coverage-threshold change.
- `pnpm test:e2e`: **240 passed / 2 failed**. All T07 tests pass. One persistent legacy visual failure, one fixture SQL deadlock.
- Final serial fresh-preview recheck (`--workers=1`, T07 suites plus both failures): **25 passed / 1 failed**. T07 **24/24** and cancelled-tombstone 320px/pt-BR/dark **pass**; all six T07 measurements reproduced. Deadlock did not recur in isolation; parallel fixture-DDL contention remains a reliability risk, not a claimed production fix.

**Previous red gate (resolved by approved successor below):** historical `started-unavailable — approved tVzco reference certification` measured **22.4741%** versus **10.5%** budget because that old composition omitted required **Record result** entry. No budget widened, action hidden, assertion skipped or reference rewritten to force green. That checkpoint was partial; approved `iXRPp` resolves this structural/design-contract difference.

Logs: `/tmp/paf108-complete-check.log`, `/tmp/paf108-test-recheck.log`, `/tmp/paf108-e2e-recheck.log`, `/tmp/paf108-final-browser-isolated.log`.

## Closure — approved started-entry successor

Design owner approved `iXRPp` in `c24ac8a`. It **succeeds `tVzco`** for `started-unavailable`. Historical `tVzco` PNG/hash/measurements remain in PAF-6 documentation; no runtime screenshot comparison uses it. Certification lives in `e2e/matches-management-visual.spec.ts`, loading the approved 2× PNG and budget from this manifest.

`iXRPp`: **18,098 / 571,350 pixels = 3.16758554%**; budget **3.6%**, headroom **0.43241446 percentage points**. Repeated fresh-preview measurement identical. Above-threshold residuals concentrate on glyph edges/weight and small icon contours after geometry and nominal typography alignment. No Chromium baseline, stretched frame, crop or widened historical tolerance.

The sole exclusion is the **existing PAF-6 runtime-clock date/time block**, shifted by the approved 54px entry insertion: `(32,426,326,38)`. Real fixture must be started by database clock; design retains sample date November 2030. Both images receive the identical inherited clock mask; budget does not cover date-copy differences. Overview/date block geometry and timezone remain independently checked. All remaining pixels, including the entire hero, action, notice, roster and footer, are compared at YIQ 0.1. Denominator is the full 390×1465 canvas, consistent with the existing management comparator.

Exact `(x,y,width,height)` probes: entry `(18,90,354,44)`; notice `(18,144,354,90)`; overview `(18,244,354,280)`; participation `(18,534,354,140)`; roster `(18,684,354,476)`; eligibility `(18,1170,354,148)`; share `(18,1328,354,44)`; URL `(18,1382,354,65)`. Header/entry/share nominal type sizes and line boxes also asserted. Result-ready detail alone gets explicit 26px header, 17px count, 14px roster-label and 15px helper line boxes through existing tokens; other detail states unchanged. Original 0.39px/4px/13px structural drift was fixed, not charged to budget.

### Parallel fixture reliability

`e2e/match-fixture-sql.ts` inserts one shared transaction-scoped advisory lock `(73073,108)` at the start of trusted fixture DO blocks, **before any relation lock or write**. All management/result fixture users share it across Playwright workers. Cleanup additionally locks parent tables first (events/state before registrations; events/proposals before versions; communities before members). This serializes contending fixture setup/DDL, not live browser RPCs. No retry, deadlock suppression, worker reduction, production lock or schema change.

Unit tests verify early lock insertion and unchanged read/query result contracts. Real serialized integration probes retain the guard on one backend, prove a second fixture blocks **without holding the event relation lock**, release the first backend, and require the contender to complete; error rollback release is checked too. All **267 affected units / 14 files** and **42 serialized integrations / 7 files** pass.

Full parallel browser suite: **242/242 PASS using 5 workers**, including the previously deadlocking cancelled-tombstone 320px/pt-BR/dark fixture and all T07 journeys/structural variants. All seven current route references certify; `iXRPp` and `alZmm` measurements reproduced exactly.

Final isolated `GIT_CONFIG_GLOBAL=/dev/null pnpm complete-check` invoked **once** for closure, on the completed source tree:

| Stage          | Result                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| db:types:check | PASS                                                                                                             |
| build          | PASS                                                                                                             |
| knip           | PASS                                                                                                             |
| typecheck      | PASS                                                                                                             |
| lint           | PASS                                                                                                             |
| format:check   | PASS                                                                                                             |
| test           | **FAIL**: units 1,270/1,270 (110 files), configured coverage 100%; integrations 268 passed / 3 failed (38 files) |
| test:e2e       | **PASS 242/242**, default 5 workers, no fixture deadlocks                                                        |

The integration failures were:

1. `community.integration.test.ts` — rejects 4097-byte settings for every descriptor: 60s timeout; reported test elapsed 592,797ms.
2. Same file — expired invitation acceptance unexpectedly succeeded.
3. `matches.management.cancellation.integration.test.ts` — expires requests/cancels invites without expiry notification cascade: 15s timeout; reported test elapsed 981,392ms.

Those two files rechecked without source changes via `GIT_CONFIG_GLOBAL=/dev/null caffeinate -is pnpm exec vitest run --config vitest.integration.config.ts test/community.integration.test.ts test/matches.management.cancellation.integration.test.ts`: **31/31 PASS in 41.08s**. Abnormal execution stalls/clock interruption suspected, not established as root cause. Post-run host/database clocks aligned and no retained `paf108-fixture-*` backend remained. No timeout/coverage increase, expectation weakening or unrelated production fix applied. Original complete gate remains **failed**, not relabeled green; no second complete-check invocation.

Remaining closure risk: unexplained full-integration timing/expiry flakiness. Approved reference and parallel browser-fixture blockers are resolved, but overall unit remains **partial** until an authorized subsequent full gate is green.

Closure logs: `/tmp/paf108-closure-units.log`, `/tmp/paf108-closure-integrations.log`, `/tmp/paf108-closure-full-e2e.log`, `/tmp/paf108-closure-complete-check.log`, `/tmp/paf108-closure-failed-integration-recheck.log`.
