import { readdirSync } from 'node:fs';
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
  'e2e/level-reviews-admin.spec.ts': 38,
  'e2e/level-reviews-player.spec.ts': 20,
  'e2e/level-reviews.spec.ts': 32,
  'e2e/matches-management.spec.ts': 87,
  'e2e/matches-provisional.spec.ts': 27,
  'e2e/matches-ranked.spec.ts': 62,
  'e2e/matches-registration.spec.ts': 71,
  'e2e/matches-results-review.spec.ts': 76,
  'e2e/matches-results.spec.ts': 24,
  'e2e/matches.spec.ts': 38,
  'e2e/notifications.spec.ts': 62,
  'e2e/onboarding.spec.ts': 34,
  'e2e/player-ratings.spec.ts': 81,
  'e2e/result-amendments-chronology.spec.ts': 21,
  'e2e/result-amendments.spec.ts': 52,
  'e2e/statistics.spec.ts': 11
};

export function listSpecs(dir = 'e2e') {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${dir}/${name}`);
}

// The result-repair retry takes the global repair lock and answers "busy" while any other worker
// finalizes or repairs results, so these specs get their own lane (own stack, nothing else running).
export const SERIAL_SPECS = ['e2e/result-repairs.spec.ts'];

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

/** Playwright CLI args for a CI lane: functional-1..N and serial run explicit specs minus @visual; visual runs only @visual. */
export function laneArgs(lane, specs = listSpecs()) {
  if (lane === 'visual') return ['--grep', VISUAL_GREP];
  if (lane === 'serial') return [...SERIAL_SPECS, '--grep-invert', VISUAL_GREP];
  const index = /^functional-(\d+)$/.exec(lane)?.[1];
  const group = index ? planGroups(specs)[Number(index) - 1] : undefined;
  if (!group) throw new Error(`Unknown E2E lane "${lane}"`);
  return [...group.specs, '--grep-invert', VISUAL_GREP];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(laneArgs(process.argv[2] ?? '').join('\n') + '\n');
}
