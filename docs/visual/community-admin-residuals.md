# Community-admin visual residuals

Comparator ignores RGB channel deltas ≤24; a pixel changes when its maximum (R, G, B) delta is >24. The six per-screen caps and mask rectangles are unchanged. Geometry assertions remain ±1px. Both geometry probes and visual comparisons passed on the measured CI run.

## Current measurements

All six screens have measurements from both macOS and Linux. macOS values are local measurements from this branch and fixture lineage. Linux values are measurements from the single green CI run below, not estimates. Headroom is `cap − max(measured macOS, measured Linux)`.

| Screen        | PNG        |    Cap | macOS measured | Linux measured                                                                                                 | Headroom |
| ------------- | ---------- | -----: | -------------: | -------------------------------------------------------------------------------------------------------------- | -------: |
| Requests      | RgqPq.png  | 18,500 |         14,864 | 15,723 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |    2,777 |
| Members       | wFqGR.png  | 15,500 |         14,198 | 15,435 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |       65 |
| Member detail | jQDkx.png  | 22,000 |         17,397 | 19,038 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |    2,962 |
| Settings      | N18Mu4.png | 22,500 |         17,750 | 18,920 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |    3,580 |
| Venues        | A5Vio.png  | 21,000 |         16,351 | 17,771 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |    3,229 |
| Audit         | E5CS5K.png | 20,000 |         16,174 | 17,044 ([CI measurement](https://github.com/trystan2k/padel-friend/actions/runs/38734384958), run 38734384958) |    2,956 |

### Linux measurement provenance

The Linux column's six values are measured results from one green CI run: [run 38734384958](https://github.com/trystan2k/padel-friend/actions/runs/38734384958). The run was created 2026-10-15 at 12:24:24Z and completed at 12:30:10Z. It tested head SHA `552c672c1e13cb2a8fa0135e16011c4f2876a1a6` on `ubuntu-24.04`, image version `20261012.334.1`, with Playwright `1.64.1`, Chromium `Chrome for Testing 156.0.8078.4` (Playwright Chromium v1248), and headless shell `156.0.8078.4` (v1248). The run reported 81 E2E tests and 506 unit tests passed.

The macOS values were measured locally on this branch using the same fixtures. The Linux measurements apply to tested SHA `552c672c1e13cb2a8fa0135e16011c4f2876a1a6`; subsequent documentation and review-fix commits do not alter the visual layer, so they do not change the measured visual evidence.

### Margin monitoring and retained evidence

Members (`wFqGR.png`) passes tightly: 15,435 of 15,500 changed pixels, 99.6% of the budget consumed and only 65px of headroom. This narrow margin carries flakiness risk. Each local repeat is recorded as an independent signal; no red run is discarded. Linux repeats are pending; do not widen the budget or change the probe.

CI did not upload the helper's per-screen JSON/PNG residual attachments for this run. The `test-reports` artifact contained only `coverage/` HTML; `test-results/` was empty because all E2E tests passed. The helper now writes compared screenshot evidence to `artifacts/community-admin-visual/`, which CI uploads with `if: always()` alongside Playwright attachments. New evidence is pending CI execution.

### Environment-limited coverage

- A live zero-member community is unreachable through the API: schema requires an active Admin and the local role cannot disable triggers. The discovery read-model zero-count `COALESCE` path is therefore covered only at UI level.
- An authenticated anonymous JWT cannot be produced locally because anonymous sign-in is disabled. The in-function anonymous-identity rejection is covered only indirectly by `anon` role EXECUTE denial and unauthenticated denial.
- These constraints are not prerequisites for unrelated features. Do not fabricate fixtures or weaken security to cover them.

## Historical / inherited Linux evidence (not final-layout certification)

Green `ci.yml` run [38620390782](https://github.com/trystan2k/padel-friend/actions/runs/38620390782), SHA `09ce042d6cb0f43b674bcfe34868d6d4b804f4ea`, 2026-10-14. Its log reports Ubuntu 24.04 image `ubuntu24/20261004.327`, runner `2.337.0`, Playwright 1.64.1, Chromium 156.0.8078.4. This older main run predates the final admin layout and is historical only; it cannot certify this branch. Its logged residuals were Requests 15,700; Members 12,720; Member detail 19,038; Settings 19,731; Venues 17,762; Audit 16,323. Exact geometry success and dependency lockfile hash were not independently retained as current-branch evidence. Do not use these values to calculate current headroom.

Older source comments are historical/inherited context, not current measurements: Requests ~14,818 / Linux reported 15,713; Members ~11,902 / 12,720; Member detail ~17,397 / 19,038; Settings ~18,616 / 19,853; Venues ~16,362 / Linux estimate 18,003; Audit ~15,485 / Linux estimate 17,126. The approximate macOS bases and Linux values came from older context. In particular, 18,003 and 17,126 were estimates, never measurements. No cap changes are made; no automatic margin formula is applied.

## Visual fixture integrity

| Screen        | Source PNG SHA-256                                                 | Mask-array SHA-256                                                 |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Requests      | `a85a6235eefc9c8387f6ff463401ad4dbec8d7d158949df69518d3bd0b9c16df` | `334a7e7833a90355382a7ab4460441ac65f0ea2104aa206df185477624c26353` |
| Members       | `9283fea3d94cc022c7e19718bed6d30f5958b08886b4a89a9d582a7f7218299d` | `1b7332ca860e37c88a394f96e7a8a9613102ddf51e91282fb1a65f95052b6ef8` |
| Member detail | `b2152acc83eb205abea4483d990e61d872140ed0dfbf414e66ab1483aff9db8b` | `8179acd90aae7058e278fde576f8213c70637be946a8ad93e832f5af13d236af` |
| Settings      | `512027e33e546fa478206ed57806b06132306a4c6516d51ef9e6fb5be88b3fe6` | `1514f2b018b009263aa45947042dc5b426cd452a1ef6061156cd8d0ace4d3144` |
| Venues        | `707a4741bf6fef96bafc3b07cc429b208ab03f600c91cc681b72cb4cf83cceb7` | `eb32ccaad656a54a8f7e933a3f4898ec99a551e5022695bf449178cbe97f22a6` |
| Audit         | `9f785a3cd61ea8e21075897b8d438c5be8c0ead4ff948f7ef09f73a1343d7eec` | `03bc85f160682fd7c4612b862d976277dda25016b45008abdc07b2e205d88a52` |
