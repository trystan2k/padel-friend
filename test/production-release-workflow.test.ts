import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

// Match indentation boundaries, like ci-workflow.test.ts; inspect only each job/step's body.
function job(name: string): string {
  const body = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|(?![\\s\\S]))`, 'm').exec(
    workflow
  )?.[1];
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
    expect(workflow.match(/^  [a-z0-9-]+:$/gm)).toEqual(['  release:', '  deploy:']);
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

  it('chains identity, install, pinned CLI, credentials and build before reserved SQL boundary', () => {
    const ordered = [
      'ref: refs/tags/',
      'node scripts/production-release-guard.mjs verify',
      'pnpm install --frozen-lockfile',
      'test "$(pnpm exec supabase --version)" = \'2.121.0\'',
      'node scripts/production-release-guard.mjs credentials',
      'run: pnpm build',
      '# U2 migration insertion point:',
      'node scripts/production-release-guard.mjs verify',
      'run: pnpm exec wrangler deploy'
    ];
    let previous = -1;
    for (const text of ordered) {
      const index = deploy.indexOf(text, previous + 1);
      expect({ text, ordered: index > previous }).toEqual({ text, ordered: true });
      previous = index;
    }
    const allSteps = steps(deploy);
    expect(allSteps.at(-2)).toContain('node scripts/production-release-guard.mjs verify');
    expect(allSteps.at(-1)).toContain('run: pnpm exec wrangler deploy');
    expect(deploy).not.toMatch(/always\(\)|continue-on-error|\|\|\s*(true|:)|set \+e/);
    expect(allSteps.every((step) => !/^\s+if:/m.test(step))).toBe(true);
    expect(deploy).not.toMatch(/supabase (db|migration|link)|--include-|--debug/);
  });

  it('keeps private credentials step-scoped and values out of shell source', () => {
    const header = deploy.split('    steps:')[0]!;
    expect(header).not.toContain('secrets.');
    for (const step of steps(deploy)) {
      const allowed =
        step.includes('production-release-guard.mjs credentials') ||
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
    expect(deploy).not.toContain('GITHUB_ENV');
  });

  it('preserves preview byte-for-byte outside production lock', () => {
    const preview = readFileSync('.github/workflows/preview.yml');
    expect(createHash('sha256').update(preview).digest('hex')).toBe(
      'da3e15f7fb4f27dcd9972b7ad94249736d96c7113979d80841466e1b782ead16'
    );
    expect(preview.toString()).not.toContain('padel-friend-production-release');
  });
});
