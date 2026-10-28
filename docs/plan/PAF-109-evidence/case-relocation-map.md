# PAF-114 Case Relocation Map

## Phase inventory reconciliation

| Phase | Before relocation | After relocation | Delta |
| --- | ---: | ---: | ---: |
| Unit | 111 files / 1,324 cases | 109 files / 1,318 cases | −2 files / −6 cases |
| Integration | 39 files / 291 cases | 41 files / 297 cases | +2 files / +6 cases |
| Combined | 150 files / 1,615 cases | 150 files / 1,615 cases | no change |

`X = 6` cases relocated. Before-phase counts are the current PAF-114 intake baseline; the checked-in `unit-cases.jsonl` and `integration-cases.jsonl` inventories predate PAF-112's later transport/batch cases. The six baseline unit identities below were matched against `unit-cases.jsonl`; after identities and statuses came from Vitest's JSON report for the full integration phase. Identity diff: exact match, six before and six after. No case removed, renamed, or skipped.

After relocation, Vitest reported 109 unit files / 1,318 passed cases and 41 integration files / 297 passed cases. Both phases reported zero failures, pending cases, and todos. Integration elapsed 126.89 seconds. Both conditional local-Supabase model cases executed and passed against the available loopback stack.

## Relocated case identities

| Full test name | Old file | New file |
| --- | --- | --- |
| `match registration FIFO model requires local Supabase in CI` | `test/matches.registration.model.test.ts` | `test/matches.registration.model.integration.test.ts` |
| `match registration FIFO model proves the independent oracle: seat chunking, hand table and boundaries agree for N=0..13` | `test/matches.registration.model.test.ts` | `test/matches.registration.model.integration.test.ts` |
| `match registration FIFO model splits the roster across N=0..13 exactly like the oracle, with contiguous positions and group boundaries at multiples of four` | `test/matches.registration.model.test.ts` | `test/matches.registration.model.integration.test.ts` |
| `match registration FIFO model binds explicit capacities 1,3,4,5,8,9 to accepted players and never closes an unlimited event at four or eight` | `test/matches.registration.model.test.ts` | `test/matches.registration.model.integration.test.ts` |
| `admin server-function extraction (production build) emits six distinct transport identities for module-level membership actions` | `test/community.admin-extraction.test.ts` | `test/community.admin-extraction.integration.test.ts` |
| `admin server-function extraction (production build) rejects an artifact older than the current build start` | `test/community.admin-extraction.test.ts` | `test/community.admin-extraction.integration.test.ts` |

## Coverage preservation

Unit remains the sole coverage-owning phase. `vitest.config.ts` still includes only `src/i18n/config.ts` and keeps all four thresholds at 80%; neither coverage scope nor threshold changed. Measurements before and after relocation:

| Metric | Threshold | Before | After |
| --- | ---: | ---: | ---: |
| Statements | 80% | 100% (9/9) | 100% (9/9) |
| Branches | 80% | 100% (8/8) | 100% (8/8) |
| Functions | 80% | 100% (2/2) | 100% (2/2) |
| Lines | 80% | 100% (7/7) | 100% (7/7) |

The pre-relocation measurement ran all 1,324 unit cases; the post-relocation measurement ran all 1,318 remaining unit cases. Existing thresholds passed both runs with 20 percentage points of headroom.

## Build ownership and mandatory phases

The admin extraction contract retains its standalone `pnpm build` in `beforeAll`; no build artifact is shared between suites. The contract rebuilds immediately before reading `dist/server/assets`, retains its fresh-artifact check, and retains the stale-artifact rejection case. Shared-build revision/input/environment provenance is not applicable because build sharing was not introduced.

Phase routing already follows filename conventions in `vitest.unit.config.ts` and `vitest.integration.config.ts`; no include/exclude changes were needed. Current CI topology is static-first: `static` blocks parallel `unit`, `integration`, and `e2e` jobs, while final aggregate `checks` requires all four jobs; branch protection keeps the required `CI / checks` name.

- `package.json:20` runs unit with coverage, then integration using `&&`.
- `.github/workflows/ci.yml` assigns static, unit, integration, E2E, and final `checks` aggregate to five jobs; `checks` owns required-phase success.
- `scripts/complete-check.mjs` remains the local all-stage aggregate gate.

Historical at relocation time (superseded by PAF-117): CI ran `pnpm test` and no CI workflow or test assertion changed. The PAF-117 CI split superseded that workflow statement; test assertions remain unchanged.
