import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const buildTimeoutMs = 120_000;
const filesystemTimestampToleranceMs = 2_000;

function isFreshArtifact(mtimeMs: number, buildStartedAtMs: number): boolean {
  return mtimeMs >= buildStartedAtMs - filesystemTimestampToleranceMs;
}

const endpointNames = [
  'approveCommunityMember',
  'denyCommunityMember',
  'removeCommunityMember',
  'reactivateCommunityMember',
  'promoteCommunityMember',
  'demoteCommunityMember'
] as const;

describe('admin server-function extraction (production build)', () => {
  let buildStartedAtMs: number;

  beforeAll(async () => {
    // Never run this production build concurrently with Playwright: both use dist.
    buildStartedAtMs = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync('pnpm', ['build'], {
        timeout: buildTimeoutMs,
        maxBuffer: 10 * 1024 * 1024
      });
      // Keep output available for diagnostics while avoiding environment values.
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    } catch (error) {
      const output = (key: 'stdout' | 'stderr') =>
        error &&
        typeof error === 'object' &&
        typeof Object.getOwnPropertyDescriptor(error, key)?.value === 'string'
          ? Object.getOwnPropertyDescriptor(error, key)?.value
          : '';
      throw new Error(
        `pnpm build failed; stdout:\n${output('stdout')}\nstderr:\n${output('stderr')}`,
        { cause: error }
      );
    }
  }, buildTimeoutMs);

  it('emits six distinct transport identities for module-level membership actions', () => {
    const assetDirectory = new URL('../dist/server/assets/', import.meta.url);
    const assets = readdirSync(assetDirectory)
      .filter((file) => /^community-admin\.functions-.*\.js$/.test(file))
      .map((file) => {
        const path = new URL(`../dist/server/assets/${file}`, import.meta.url);
        expect(
          isFreshArtifact(statSync(path).mtimeMs, buildStartedAtMs),
          `${file} must have been emitted by this build`
        ).toBe(true);
        return readFileSync(path, 'utf8');
      })
      .filter((content) => content.includes('createServerRpc({'));
    expect(assets).toHaveLength(1);
    const compiled = assets[0]!;
    const ids = endpointNames.map((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = compiled.match(
        new RegExp(
          `var ${escaped}_createServerFn_handler = createServerRpc\\(\\{[\\s\\S]*?id: "([a-f0-9]{64})"`
        )
      );
      expect(match, `${name} must have a compiler-generated transport ID`).not.toBeNull();
      return match?.[1];
    });
    expect(new Set(ids).size).toBe(endpointNames.length);
  });

  it('rejects an artifact older than the current build start', () => {
    const staleMtimeMs = Date.now() - filesystemTimestampToleranceMs - 1;
    expect(isFreshArtifact(staleMtimeMs, Date.now())).toBe(false);
  });
});
