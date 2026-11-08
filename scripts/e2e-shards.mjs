import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Visual selection, shared by every consumer (CI lanes, the local fast lane): a test is visual when it
// is tagged @visual or lives in a *-visual.spec.ts file (Playwright greps tags and the file path).
export const VISUAL_GREP = '@visual|-visual\\.spec\\.ts';
export const FUNCTIONAL_LANES = 3;
// Conservative weight (seconds) for a functional spec missing from SPEC_WEIGHTS: it still joins a lane.
export const DEFAULT_WEIGHT_SECONDS = 60;

// Functional (non-@visual) test runtime per spec in seconds, summed from a single clean
// `pnpm test:e2e --retries=0 --reporter=json` run (no retries, no timeouts). Regenerate from fresh
// evidence when a lane becomes the CI tail; test/e2e-shards.test.ts rejects stale or missing entries.
export const SPEC_WEIGHTS = {
  'e2e/auth-password-reset.spec.ts': 6,
  'e2e/auth-return.spec.ts': 13,
  'e2e/community-admin-expansion.spec.ts': 11,
  'e2e/community-admin.spec.ts': 107,
  'e2e/community-lifecycle.spec.ts': 7,
  'e2e/community-onboarding.spec.ts': 30,
  'e2e/home.spec.ts': 3,
  'e2e/league-standings.spec.ts': 18,
  'e2e/leagues.spec.ts': 16,
  'e2e/matches-management.spec.ts': 87,
  'e2e/matches-provisional.spec.ts': 27,
  'e2e/matches-ranked.spec.ts': 62,
  'e2e/matches-registration.spec.ts': 71,
  'e2e/matches-results-review.spec.ts': 76,
  'e2e/matches-results.spec.ts': 24,
  'e2e/matches.spec.ts': 38,
  'e2e/onboarding.spec.ts': 34,
  'e2e/player-ratings.spec.ts': 81,
  'e2e/push-preferences.spec.ts': 40,
  'e2e/pwa.spec.ts': 13,
  'e2e/result-amendments-chronology.spec.ts': 21,
  'e2e/result-amendments.spec.ts': 52
};

// Recursive like Playwright's own discovery, so nested specs still land in a lane.
export function listSpecs(dir = 'e2e') {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listSpecs(`${dir}/${entry.name}`)
        : entry.name.endsWith('.spec.ts')
          ? [`${dir}/${entry.name}`]
          : []
    )
    .sort((a, b) => a.localeCompare(b));
}

// Specs that cannot share a worker pool with the rest get their own lane (own stack, nothing else
// running):
// - result-repairs: the result-repair retry takes the global repair lock and answers "busy" while any
//   other worker finalizes or repairs results.
// - statistics, level-reviews, level-reviews-admin, level-reviews-player: they read and assert GLOBAL
//   rating-revision and statistics-projection state, which every concurrent ranked/result test bumps
//   (observed in complete-check gate runs 1-5, Nov 2026: statistics.spec.ts:177 failed with
//   projection 404s in all five, level-reviews-admin.spec.ts:43 in two with the approval dialog never
//   rendering on a stale review, level-reviews-player.spec.ts:207 once with LEVEL_REVIEW_STALE_RATING
//   from the fixture resolve RPC). CI retries had been masking the same race. The visual variants
//   (e.g. level-reviews-visual.spec.ts) stay lane-routed: they passed consistently under concurrency.
// - notifications: its mark-all-read cutoff test races a concurrently arriving notification by design
//   (failed in about 3 of 9 full-sweep runs, passes alone).
// - result-corrections-visual: its repair-diagnostics probes depend on the repair-lease lifecycle (an
//   earlier describe deliberately holds a 600s lease), so a changed sweep order shifts their layout.
// A serial spec runs whole: serial wins over visual, so its @visual tests stay in the serial lane and the
// visual lane never selects the file (no test is in two lanes). The local gate runs the serial specs
// with --workers=1 so they are genuinely serial; the CI serial lane keeps the default workers and
// retries=2.
// Enforced in the CI lanes and in the local gate's e2e stage (scripts/complete-check.mjs, via
// gateLanes); standalone `pnpm test:e2e` and `pnpm test:e2e:fast` stay one flat invocation, so a
// local run of those can still hit the "busy" race on these specs.
export const SERIAL_SPECS = [
  'e2e/level-reviews-admin.spec.ts',
  'e2e/level-reviews-player.spec.ts',
  'e2e/level-reviews.spec.ts',
  'e2e/notifications.spec.ts',
  'e2e/result-corrections-visual.spec.ts',
  'e2e/result-repairs.spec.ts',
  'e2e/statistics.spec.ts'
];

const E2E_DIR = fileURLToPath(new URL('../e2e', import.meta.url));

// Repo-relative `e2e/...` spec path (posix separators) for a spec found under `dir`.
export const repoRelativeSpec = (dir, spec) =>
  `e2e/${path.relative(dir, spec).split(path.sep).join('/')}`;

/**
 * The local gate's e2e invocations as repo-relative spec lists: the main sweep (every spec except
 * SERIAL_SPECS, found by the same recursive discovery as listSpecs) then the serial specs. Throws when
 * a serial spec no longer exists, so the list cannot rot silently.
 */
export function gateLanes(dir = E2E_DIR) {
  const all = listSpecs(dir).map((spec) => repoRelativeSpec(dir, spec));
  const missing = SERIAL_SPECS.filter((spec) => !all.includes(spec));
  if (missing.length > 0) throw new Error(`Serial E2E spec(s) not found: ${missing.join(', ')}`);
  return { main: all.filter((spec) => !SERIAL_SPECS.includes(spec)), serial: [...SERIAL_SPECS] };
}

// Filename-only check for standalone visual spec files: used by planGroups to keep them out of the
// functional lanes. Lane selection itself (visual lane, --grep-invert) uses VISUAL_GREP, which also
// matches @visual-tagged tests inside non-visual files.
export const isVisualFile = (spec) => /-visual\.spec\.ts$/.test(spec);

/** Longest-processing-time assignment, deterministic: ties break on spec path, then lowest lane. */
export function planGroups(specs, weights = SPEC_WEIGHTS, count = FUNCTIONAL_LANES) {
  const groups = Array.from({ length: count }, () => ({ specs: [], seconds: 0 }));
  const weight = (spec) => weights[spec] ?? DEFAULT_WEIGHT_SECONDS;
  const ordered = specs
    .filter((spec) => !isVisualFile(spec) && !SERIAL_SPECS.includes(spec))
    .sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const spec of ordered) {
    const lightest = groups.reduce((best, group) => (group.seconds < best.seconds ? group : best));
    lightest.specs.push(spec);
    lightest.seconds += weight(spec);
  }
  for (const group of groups) group.specs.sort((a, b) => a.localeCompare(b));
  return groups;
}

/**
 * Playwright CLI args for a CI lane: functional-1..N run explicit specs minus @visual; serial runs its
 * specs whole (serial wins over visual); visual runs the @visual tests of every non-serial spec.
 */
export function laneArgs(lane, specs = listSpecs()) {
  if (lane === 'visual') {
    return [...specs.filter((spec) => !SERIAL_SPECS.includes(spec)), '--grep', VISUAL_GREP];
  }
  if (lane === 'serial') return [...SERIAL_SPECS];
  const index = /^functional-(\d+)$/.exec(lane)?.[1];
  const group = index ? planGroups(specs)[Number(index) - 1] : undefined;
  if (!group) throw new Error(`Unknown E2E lane "${lane}"`);
  return [...group.specs, '--grep-invert', VISUAL_GREP];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(laneArgs(process.argv[2] ?? '').join('\n') + '\n');
}
