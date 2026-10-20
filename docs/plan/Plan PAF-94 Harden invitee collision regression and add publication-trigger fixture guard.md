## Task Analysis

- Main objective: PAF-94 — Harden invitee collision regression and add publication-trigger fixture guard; two test files only.
- Identified dependencies: existing local Supabase, migrated schema, loopback credentials; existing match-photo helper. Runtime availability unverified; missing DB/credentials blocks integration acceptance until restored, not deferred.
- System impact: tests only; no SQL, product, dependency, coverage-config, UI, or locale changes. Accessibility/i18n not applicable.

## Chosen Approach

- Proposed solution: deterministic name prefixes plus real broad/targeted RPC checks; one standalone filesystem guard with in-memory negative controls.
- Justification for simplicity: reuse existing 21 collision actors and Node filesystem APIs. Reject extra actors/DB orchestration and AST/SQL-parser dependencies.
- Components to be modified/created: modify `test/community.invitee.integration.test.ts`; create `test/fixtures.publication-trigger.test.ts`.
- Verified contract: requested migration actually orders by `p.display_name,p.user_id`, NOT lower(display_name). Same-case A/Z prefixes work for either ordering; no migration edits.

## Implementation Steps

1. Preflight: confirm supplied branch/base, clean product tree, helper's trigger-valid storage/path contract, and local Supabase readiness. Read migration and current tests; retain existing 60s timeout and all existing assertions.
2. F3: rename target to `Z Literal 100%_.* ` + specialMarker + ` Name`; collision names to `A Literal 100%_.* ` + collisionMarker + ` Candidate ` + index. Keep 21 collisions, separate random markers, existing concurrent creation/opt-ins and successful opt-in assertions. Prefix establishes order before UUIDs, independent of user_id tie-breaks.
   - Targeted query `100%_.* ` + specialMarker: error null; IDs exactly [special.id] (retain existing assertion).
   - Broad query `100%_.*` with limit 20: error null; data length exactly 20 (stronger than at most 20); IDs exclude special.id. Run after all 21 opt-ins; do not assert exact broad IDs/order because earlier runs may contribute rows.
   - Negative query `100%_x ` + specialMarker: error null; IDs exclude special.id. Preserve remaining auth, membership, withdrawal and result-shape assertions.
   - Unit commit: `test: strengthen capped invitee discovery regression`.
3. F4: standalone Vitest guard; resolve repo root with `fileURLToPath(new URL('../', import.meta.url))`, not process.cwd(). Recursively enumerate regular source files under test/** using readdirSync({ withFileTypes: true }); sort paths; read UTF-8 once. Include ts/tsx/js/jsx/mjs/cjs/mts/cts/sql; never follow symlinks. No shell/grep, database, dependency or generated build requirement.
   - File-local detector returns forbidden matches; same assertion helper consumes {path, source} records for disk scan and synthetic controls. Report offending relative paths and direct contributors to test/helpers/match-photo-fixtures.ts.
   - Case-insensitive detection: DISABLE TRIGGER and ENABLE [ALWAYS|REPLICA] TRIGGER with optional double-quoted lock_match_photo_publication. Also reject blanket TRIGGER ALL/USER toggles and session_replication_role assignments (SET or set_config), which bypass publication protection without naming it.
   - Allow arbitrary whitespace/newlines and SQL block/line comments between SQL tokens via regex separator pattern; match operation plus trigger target, not bare helper documentation mentions. No brittle single-line scan or full SQL parser.
   - Include guard file itself: synthesize forbidden SQL from separately stored operation/target tokens using join, avoiding contiguous forbidden source text. No file allowlist or exclusion to hide real toggles.
   - Parameterized synthetic records cover disable, enable, enable always/replica, casing, quoting, multiline/comment separators, ALL/USER and replication-role forms. Assert shared guard throws with synthetic path + helper guidance; safe source/helper documentation passes. Never write synthetic fixtures to repo or execute SQL.
   - Unit commit: `test: guard fixtures against publication trigger toggles`.
4. Validate each unit with focused Vitest run, pnpm typecheck and pnpm lint before commit. Final reviewed tree: pnpm complete-check; fix required/related failures within scope, never lower thresholds or widen budgets.

## Validation

- Success criteria: F3/AC1 proven by step 2's exact target, exactly-20 broad exclusion, negative query and preserved assertions; F4/AC2 proven by step 3's disk pass plus synthetic shared-assertion failures; AC3 proven by final complete-check exit 0 with unchanged thresholds.
- Checkpoints: step 1 records DB readiness/blocker evidence; step 2 runs `pnpm exec vitest run test/community.invitee.integration.test.ts`; step 3 runs `pnpm exec vitest run test/fixtures.publication-trigger.test.ts`; step 4 records fast/full gate output and test-only diff.
- Risks/mitigation: keep existing actor count/concurrency/timeout; one extra RPC only. Persistent local DB accumulates opted-in actors: random targeted markers isolate runs, 21 current A-prefixed actors ensure broad target exclusion regardless of old rows; avoid broad-ID assumptions or automatic destructive reset.
- Coverage/new file: Vitest discovers test/**/*.test.{ts,tsx}; coverage currently includes only src/i18n/config.ts. Guard needs no production export or config exclusion; exercise detector positive/negative paths directly and keep 80% thresholds untouched.
- Guard boundary: static literal SQL policy, not arbitrary dynamically obfuscated execution analysis; synthetic token composition only for self-tests. Keep traversal bounded to test/, deterministic and shell-free.
- Rollback/blocked gates: no elevated production risk; revert only test-unit changes if needed, leaving criteria incomplete. No retries, sleeps, automatic follow-ups, product changes or unrelated cleanup.
