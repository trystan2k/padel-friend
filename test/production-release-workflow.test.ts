import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
const jobsSource = workflow.split('\njobs:\n')[1]!;
const jobNames = [...jobsSource.matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):$/gm)].map(
  (match) => match[1]
);

// Match indentation boundaries, like ci-workflow.test.ts; inspect only each job/step's body.
function job(name: string): string {
  const body = new RegExp(
    `^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z_][A-Za-z0-9_-]*:\\n|(?![\\s\\S]))`,
    'm'
  ).exec(jobsSource)?.[1];
  if (body === undefined) throw new Error(`job ${name} not found`);
  return body;
}

function steps(body: string): string[] {
  return body.split(/^      - /m).slice(1);
}

function stepContaining(body: string, text: string): string {
  const matches = steps(body).filter((step) => step.includes(text));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function shellSource(step: string): string {
  const lines = step.split('\n');
  const start = lines.findIndex((line) => /^(?:run:|        run:)/.test(line));
  if (start < 0) return '';
  if (lines[start]!.trim() !== 'run: |') return lines[start]!;
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() !== '' && !line.startsWith('          ')
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

const release = job('release');
const deploy = job('deploy');
const privateNames = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
];

describe('production release workflow safety contract', () => {
  it('preserves successful push-CI/main provenance and root Release Please outputs', () => {
    expect(workflow).toContain('workflows: [CI]\n    types: [completed]\n    branches: [main]');
    for (const predicate of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
      'github.event.workflow_run.head_repository.full_name == github.repository'
    ])
      expect(release.split('\n').find((line) => line.startsWith('    if:'))).toContain(predicate);
    expect(release).toContain('ref: ${{ github.event.workflow_run.head_sha }}');
    expect(release).toContain('created: ${{ steps.release.outputs.release_created }}');
    expect(release).toContain('tag: ${{ steps.release.outputs.tag_name }}');
    expect(release).toContain('release_sha: ${{ steps.identity.outputs.release_sha }}');
    const please = stepContaining(release, 'googleapis/release-please-action@v4');
    expect(please).toContain('token: ${{ secrets.RELEASE_PLEASE_TOKEN }}');
    expect(please).toContain('config-file: release-please-config.json');
    expect(please).toContain('manifest-file: release-please-manifest.json');
    const record = stepContaining(release, 'node scripts/production-release-guard.mjs record');
    expect(record).toContain("if: steps.release.outputs.release_created == 'true'");
    expect(record).toContain('RELEASE_CREATED: ${{ steps.release.outputs.release_created }}');
    expect(record).toContain('RELEASE_TAG: ${{ steps.release.outputs.tag_name }}');
  });

  it('places every production step behind one approval gate and shared noncancelling lock', () => {
    expect(jobNames).toEqual(['release', 'deploy']);
    expect(workflow).not.toMatch(/<<:|[&*][A-Za-z_]/);
    expect(workflow.match(/environment: production/g)).toHaveLength(1);
    expect(deploy).toContain('    environment: production\n');
    expect(deploy).toContain('    permissions:\n      contents: read\n');
    expect(deploy).toContain(
      '    concurrency:\n      group: padel-friend-production-release\n      cancel-in-progress: false\n'
    );
    expect(deploy).toContain(
      'name: Production ${{ needs.release.outputs.tag }} @ ${{ needs.release.outputs.release_sha }}'
    );
    expect(release).not.toMatch(/wrangler|supabase db|environment: production|concurrency:/);
    expect(deploy).not.toContain('RELEASE_PLEASE_TOKEN');
  });

  it('uses only the recorded release revision, never latest/main fallback', () => {
    expect(deploy).toContain('needs: release');
    expect(deploy).toContain("if: needs.release.outputs.created == 'true'");
    expect(steps(deploy)[0]).toContain('ref: refs/tags/${{ needs.release.outputs.tag }}');
    expect(deploy).toContain('RELEASE_CREATED: ${{ needs.release.outputs.created }}');
    expect(deploy).toContain('RELEASE_TAG: ${{ needs.release.outputs.tag }}');
    expect(deploy).toContain('RELEASE_SHA: ${{ needs.release.outputs.release_sha }}');
    expect(deploy).not.toMatch(/ref: (main|latest)|git checkout/);
  });

  it('chains identity, install, pinned CLI, credentials and build before SQL', () => {
    const ordered = [
      'ref: refs/tags/',
      'node scripts/production-release-guard.mjs verify',
      'pnpm install --frozen-lockfile',
      'test "$(pnpm exec supabase --version)" = \'2.121.0\'',
      'node scripts/production-release-guard.mjs credentials',
      'run: pnpm build',
      'node scripts/production-migrations.mjs',
      'node scripts/production-release-guard.mjs verify',
      'run: pnpm exec wrangler deploy'
    ];
    let previous = -1;
    for (const text of ordered) {
      const index = deploy.indexOf(text, previous + 1);
      expect({ text, ordered: index > previous }).toEqual({ text, ordered: true });
      previous = index;
    }
    const allSteps = steps(deploy).filter(
      (step) => !step.includes('Report incomplete production release')
    );
    expect(allSteps.at(-2)).toContain('node scripts/production-release-guard.mjs verify');
    expect(allSteps.at(-1)).toContain('run: pnpm exec wrangler deploy');
    expect(allSteps.join('\n')).not.toMatch(/always\(\)|continue-on-error|\|\|\s*(true|:)|set \+e/);
    expect(allSteps.every((step) => !/^\s+if:/m.test(step))).toBe(true);
    expect(deploy).not.toMatch(/supabase (db|migration|link)|--include-|--debug/);
  });

  it('keeps private credentials step-scoped and values out of shell source', () => {
    const header = deploy.split('    steps:')[0]!;
    expect(header).not.toContain('secrets.');
    for (const step of steps(deploy)) {
      const allowed =
        step.includes('production-release-guard.mjs credentials') ||
        step.includes('node scripts/production-migrations.mjs') ||
        step.includes('pnpm exec wrangler deploy');
      expect(privateNames.filter((name) => !allowed && step.includes(name))).toEqual([]);
      for (const line of step.split('\n').filter((source) => source.trimStart().startsWith('run:')))
        expect(line).not.toContain('${{');
    }
    const build = stepContaining(deploy, 'run: pnpm build');
    expect(build).toContain('VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}');
    expect(build).toContain(
      'VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}'
    );
    const worker = stepContaining(deploy, 'pnpm exec wrangler deploy');
    expect(worker).not.toContain('SUPABASE_');
    for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'])
      expect(
        steps(deploy).filter((step) => step.includes(name + ': ${{ secrets.' + name + ' }}'))
      ).toHaveLength(1);
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])
      expect(
        steps(deploy).filter((step) => step.includes(name + ': ${{ secrets.' + name + ' }}'))
      ).toEqual([worker]);
    const migration = stepContaining(deploy, 'node scripts/production-migrations.mjs');
    expect(migration).toContain(
      "CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID != '' && 'present' || '' }}"
    );
    expect(migration).toContain(
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN != '' && 'present' || '' }}"
    );
    expect(migration).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(migration).toContain('SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}');
    expect(migration.indexOf('production-release-guard.mjs verify')).toBeLessThan(
      migration.indexOf('production-migrations.mjs')
    );
    expect(deploy).not.toContain('GITHUB_ENV');
  });

  it('confines pending/rejected/cancelled approvals and no-op releases to the same protected job', () => {
    // Structural proof only: GitHub enforces review/queue states. Required reviewers,
    // bypass posture and actual rerun approvals require settings/live-run evidence.
    const mutations = steps(deploy).filter((step) =>
      /production-migrations\.mjs|wrangler deploy/.test(step)
    );
    expect(mutations).toHaveLength(2);
    expect(release).not.toMatch(/production-migrations|wrangler/);
    expect(deploy.split('    steps:')[0]).toContain('environment: production');
    expect(mutations.every((step) => !/^\s+if:/m.test(step))).toBe(true);
    expect(deploy).not.toMatch(
      /pending.*==|migration_count|skip.migration|workflow_dispatch|queue:.*fifo/i
    );
    expect(steps(deploy).filter((step) => step.includes('pnpm exec wrangler deploy'))).toHaveLength(
      1
    );
  });

  it('reports schema-ahead risk after migration or Worker failure without enabling mutation', () => {
    const summary = stepContaining(deploy, 'Report incomplete production release');
    expect(summary).toContain(
      "if: always() && (steps.migrations.outcome == 'failure' || (steps.migrations.outcome == 'success' && steps.worker.outcome != 'success'))"
    );
    expect(stepContaining(deploy, 'node scripts/production-migrations.mjs')).toContain(
      'id: migrations'
    );
    expect(stepContaining(deploy, 'pnpm exec wrangler deploy')).toContain('id: worker');
    expect(summary).toContain('Schema may be ahead or partially changed.');
    expect(summary).toContain('GITHUB_STEP_SUMMARY');
    expect(summary).not.toMatch(/secrets\.|node |pnpm |supabase |wrangler |continue-on-error/);
    expect(steps(deploy).filter((step) => step.includes('always()'))).toEqual([summary]);
    expect(steps(deploy).at(-1)).toBe(summary);
  });

  it('keeps every shell line expression-free and build/install credentials-free', () => {
    for (const step of steps(deploy)) {
      const command = shellSource(step);
      expect(command).not.toContain('${{');
    }
    for (const command of ['pnpm build', 'pnpm install --frozen-lockfile']) {
      const step = stepContaining(deploy, 'run: ' + command);
      expect(step).not.toMatch(
        /secrets\.|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|CLOUDFLARE_|GITHUB_ENV/
      );
    }
    expect(deploy).not.toMatch(/cancel-in-progress: true|group:.*\$\{\{/);
  });

  it('preserves preview byte-for-byte outside production lock', () => {
    const preview = readFileSync('.github/workflows/preview.yml');
    expect(createHash('sha256').update(preview).digest('hex')).toBe(
      'da3e15f7fb4f27dcd9972b7ad94249736d96c7113979d80841466e1b782ead16'
    );
    expect(preview.toString()).not.toContain('padel-friend-production-release');
  });
});
