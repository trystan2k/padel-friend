import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Narrow inventory guard for the test backend transports. It does NOT grep the whole repo (mock
// literals in unit tests are legitimate): it inspects an explicit, centrally maintained list of the
// executable entrypoints/helpers that talk to a real backend, and requires each to route through the
// shared TEST resolver instead of a root-CLI, root .env or dev-port default.
const read = (file: string) => readFileSync(file, 'utf8');

// Every executable test-backend call site named in the PAF-124 consumer inventory.
const CALL_SITES: Array<{ file: string; routedThrough: RegExp }> = [
  { file: 'scripts/integration-db-url.mjs', routedThrough: /test-stack-env\.mjs/ },
  { file: 'scripts/run-integration.mjs', routedThrough: /test-stack-env\.mjs/ },
  { file: 'scripts/db-types.mjs', routedThrough: /testCliArgs/ },
  { file: 'scripts/release-rehearsal-lib.mjs', routedThrough: /TEST_DB_CONTAINER/ },
  { file: 'scripts/release-migration-rehearsal.mjs', routedThrough: /testCliArgs/ },
  { file: 'scripts/test-populated-migration-up.mjs', routedThrough: /testCliArgs/ },
  { file: 'scripts/e2e-build-env.mjs', routedThrough: /resolveTestStackEnv/ },
  { file: 'scripts/with-test-stack.mjs', routedThrough: /resolveTestStackEnv/ },
  { file: 'scripts/complete-check.mjs', routedThrough: /resolveTestBuildEnv/ },
  {
    file: 'test/helpers/sql-transport.ts',
    routedThrough: /discoverTestDatabaseUrl[\s\S]*testQueryArgs/
  },
  { file: 'test/helpers/match-add-player-fixtures.ts', routedThrough: /requireTestEnv/ },
  {
    file: 'test/helpers/result-repair-scheduler-setup.ts',
    routedThrough: /discoverTestDatabaseUrl/
  },
  { file: 'test/helpers/local-supabase-env.ts', routedThrough: /validateTestEnv/ },
  { file: 'test/matches.results.schema.integration.test.ts', routedThrough: /testCliArgs/ },
  { file: 'e2e/rating-suite-lock.ts', routedThrough: /testDatabaseUrl/ },
  { file: 'e2e/result-repairs.spec.ts', routedThrough: /testDatabaseUrl/ },
  { file: 'e2e/match-fixture-cleanup.ts', routedThrough: /spawnTestSql/ },
  { file: 'e2e/matches-management-fixtures.ts', routedThrough: /spawnTestSql/ },
  { file: 'e2e/matches-registration-visual.spec.ts', routedThrough: /spawnTestSql/ },
  { file: 'e2e/matches-registration.spec.ts', routedThrough: /spawnTestSql/ },
  { file: 'e2e/matches-visual.spec.ts', routedThrough: /spawnTestSql/ },
  { file: 'e2e/matches.spec.ts', routedThrough: /spawnTestSql/ },
  ...[
    'auth-password-reset',
    'auth-return',
    'matches-provisional',
    'matches-ranked',
    'player-ratings'
  ].map((name) => ({ file: 'e2e/' + name + '.spec.ts', routedThrough: /testMailpitUrl\(\)/ })),
  ...[
    'auth-return',
    'community-admin',
    'community-admin-expansion',
    'community-lifecycle',
    'community-onboarding',
    'matches',
    'matches-registration',
    'matches-registration-visual',
    'matches-visual',
    'notifications',
    'push-preferences',
    'pwa'
  ].map((name) => ({ file: 'e2e/' + name + '.spec.ts', routedThrough: /testSupabaseConfig\(\)/ }))
];

// Forbidden in any call site: a raw (root) CLI argv, a root .env read, or a dev default literal.
const FORBIDDEN: Array<[string, RegExp]> = [
  ['raw root CLI argv', /\[\s*'exec',\s*'supabase'/],
  ['root .env read', /['"]\.\.\/\.env['"]|path\.join\([^)]*['"]\.env['"]/],
  ['dev API/DB/Studio/Mailpit/OAuth-stub port', /\b(?:55321|55322|55323|55324|55399)\b/],
  ['dev database container', /supabase_db_padel-friend(?!-test)/]
];

describe('test backend call sites route through the shared TEST resolver', () => {
  it.each(CALL_SITES.map((site) => [site.file, site] as const))('%s', (_file, site) => {
    const source = read(site.file);
    expect(source).toMatch(site.routedThrough);
    for (const [label, pattern] of FORBIDDEN) {
      // The central CLI builder is the one place that names the supabase argv.
      expect({ file: site.file, label, forbidden: pattern.test(source) }).toEqual({
        file: site.file,
        label,
        forbidden: false
      });
    }
  });

  it('keeps the inventory complete: every e2e/helper file that spawns the CLI is listed', () => {
    const listed = new Set(CALL_SITES.map((site) => site.file));
    const candidates = [
      ...readdirSync('e2e')
        .filter((name) => /\.ts$/.test(name))
        .map((name) => 'e2e/' + name),
      ...readdirSync('test/helpers')
        .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
        .map((name) => 'test/helpers/' + name)
    ].filter((file) => !/test-supabase-config\.ts$|test-stack-status\.ts$/.test(file));
    const unlisted = candidates.filter(
      (file) =>
        !listed.has(file) &&
        /supabase['"],|status -o env|--local|\.\.\/\.env|55321|55322|55324|55399/.test(read(file))
    );
    expect(unlisted).toEqual([]);
  });

  it('keeps raw CLI construction inside the two central test-stack modules', () => {
    const central = new Set(['scripts/test-stack.mjs', 'scripts/test-stack-env.mjs']);
    const offenders = readdirSync('scripts')
      .filter((name) => /\.(mjs|mts)$/.test(name))
      .map((name) => 'scripts/' + name)
      // The opt-in isolation proof deliberately addresses BOTH projects, non-destructively.
      .filter((file) => file !== 'scripts/verify-test-stack-isolation.mjs')
      // The release-pipeline migration runner targets the PRODUCTION project only
      // (linked project ref + pooler, never the test stack or local ports), so it
      // does not fall under this guard's test-stack isolation intent.
      .filter((file) => file !== 'scripts/production-migrations.mjs')
      .filter((file) => !central.has(file) && /\[\s*'exec',\s*'supabase'/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('pins every package script that touches Supabase to an explicit project', () => {
    const pkg: { scripts: Record<string, string> } = JSON.parse(read('package.json'));
    const direct = Object.entries(pkg.scripts).filter(([, command]) =>
      /\bsupabase\b/.test(command)
    );
    expect(Object.fromEntries(direct)).toEqual({
      'db:start': 'supabase --workdir . start',
      'db:stop': 'supabase --workdir . stop',
      'db:reset:dev': 'supabase --workdir . db reset --local'
    });
    for (const name of ['test', 'test:e2e', 'test:e2e:fast', 'test:integration', 'db:reset'])
      expect(pkg.scripts[name]).not.toMatch(/\bsupabase\b(?!:)/);
  });

  it('installs the validated tuple in both configs before any file is collected', () => {
    const vitest = read('vitest.integration.config.ts');
    const playwright = read('playwright.config.ts');
    expect(vitest).toMatch(
      /const testEnv = ensureTestStackEnv\(\);[\s\S]*export default defineConfig/
    );
    expect(playwright).toMatch(
      /const testEnv = ensureTestStackEnv\(\);[\s\S]*export default defineConfig/
    );
    // The unit config stays DB-free: it never resolves the test stack.
    expect(read('vitest.unit.config.ts')).not.toMatch(/test-stack|ensureTestStackEnv/);
    expect(read('vitest.config.ts')).not.toMatch(/test-stack|ensureTestStackEnv/);
  });

  it('keeps the controlled OAuth stub and Keycloak URL on the same test port', () => {
    const port = /CONTROLLED_PROVIDER_PORT = (\d+)/.exec(
      read('test/helpers/controlled-oauth-provider.ts')
    )?.[1];
    expect(port).toBe('55499');
    const config = read(path.join('test/stack/supabase/config.toml'));
    expect(config).toContain('host.docker.internal:' + port + '/realms/controlled');
    expect(config).toContain('http://127.0.0.1:55421/auth/v1/callback');
  });
});
