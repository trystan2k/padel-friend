import { describe, expect, it, vi } from 'vitest';
import {
  assertCredentials,
  guardRelease,
  main,
  validateCandidate,
  type GuardExec,
  type ReleaseCandidate
} from '../scripts/production-release-guard.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const TAG = 'v0.1.1';
const REPOSITORY = 'owner/padel-friend';
const event = (overrides = {}) => ({
  repository: { full_name: REPOSITORY },
  workflow_run: {
    head_repository: { full_name: REPOSITORY },
    head_branch: 'main',
    event: 'push',
    conclusion: 'success',
    head_sha: SHA,
    ...overrides
  }
});
const candidate = (overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate => ({
  event: event(),
  repository: REPOSITORY,
  created: 'true',
  tag: TAG,
  releaseSha: SHA,
  ...overrides
});

function executor({ head = SHA, tag = SHA, main: remoteMain = SHA, annotated = false } = {}) {
  return vi.fn<GuardExec>((file, args, options) => {
    expect(file).toBe('git');
    expect(options).toMatchObject({ timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return head + '\n';
    if (args.join(' ') === `ls-remote --exit-code origin refs/tags/${TAG} refs/tags/${TAG}^{}`)
      return (
        `${annotated ? OTHER : tag}\trefs/tags/${TAG}\n` +
        (annotated ? `${tag}\trefs/tags/${TAG}^{}\n` : '')
      );
    if (args.join(' ') === 'ls-remote --exit-code origin refs/heads/main')
      return `${remoteMain}\trefs/heads/main\n`;
    throw new Error('Unexpected command');
  });
}

describe('production release identity guard', () => {
  it.each([false, true])('accepts current release, annotated tag: %s', (annotated) => {
    const exec = executor({ annotated });
    expect(guardRelease(candidate(), exec)).toEqual({ tag: TAG, releaseSha: SHA });
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it.each([
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'foreign/repo' } }
  ])('rejects ineligible CI before looking up refs: %j', (overrides) => {
    const exec = executor();
    expect(() => guardRelease(candidate({ event: event(overrides) }), exec)).toThrow(
      'ineligible CI provenance'
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([
    { created: undefined },
    { created: 'false' },
    { created: true },
    { tag: undefined },
    { tag: 'v0.1.1\nrelease_sha=bad' },
    { tag: '$(secret)' },
    { releaseSha: undefined },
    { releaseSha: 'abc' },
    { releaseSha: OTHER }
  ])('rejects missing, malformed or mismatched outputs: %j', (overrides) => {
    const exec = executor();
    expect(() => guardRelease(candidate(overrides), exec)).toThrow(/release|ref/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects repository mismatch and absent event', () => {
    expect(() => validateCandidate(candidate({ repository: 'other/repo' }))).toThrow(
      'ineligible CI provenance'
    );
    expect(() => validateCandidate(candidate({ event: null }))).toThrow('ineligible CI provenance');
  });

  it.each([
    [{ head: OTHER }, 'checkout identity mismatch'],
    [{ tag: OTHER }, 'remote tag identity mismatch'],
    [{ main: OTHER }, 'stale release: main advanced']
  ] as const)('rejects divergent identity: %j', (refs, reason) => {
    expect(() => guardRelease(candidate(), executor(refs))).toThrow(reason);
  });

  it('rereads main after migration; earlier success cannot authorize stale deploy', () => {
    const exec = executor();
    guardRelease(candidate(), exec);
    exec.mockImplementation(executor({ main: OTHER }));
    expect(() => guardRelease(candidate(), exec)).toThrow('stale release');
    expect(exec).toHaveBeenCalledTimes(6);
  });

  it.each([0, 1, 2])(
    'fails closed on inaccessible ref command %s without leaking errors',
    (index) => {
      const exec = executor();
      const normal = exec.getMockImplementation()!;
      let calls = 0;
      exec.mockImplementation((...args) => {
        if (calls++ === index) throw new Error('secret-canary postgres://private');
        return normal(...args);
      });
      expect(() => guardRelease(candidate(), exec)).toThrow(/^ref lookup failed$/);
    }
  );

  it.each([
    '',
    'garbage',
    `${SHA}\trefs/heads/foreign`,
    `${SHA}\trefs/tags/${TAG}\n${SHA}\trefs/tags/${TAG}`
  ])('rejects missing, malformed, unexpected and duplicate remote refs', (output) => {
    const exec = executor();
    exec.mockImplementationOnce(() => SHA).mockImplementationOnce(() => output);
    expect(() => guardRelease(candidate(), exec)).toThrow(/release|ref/);
  });
});

describe('production guard CLI', () => {
  const env = {
    GITHUB_EVENT_PATH: 'event.json',
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_OUTPUT: 'output',
    RELEASE_CREATED: 'true',
    RELEASE_TAG: TAG,
    RELEASE_SHA: SHA
  };

  it('records only the validated peeled commit; verify preserves recorded output', () => {
    const append = vi.fn<(file: string, text: string) => void>();
    const out = { write: vi.fn<(text: string) => unknown>() };
    const io = {
      env,
      exec: executor({ annotated: true }),
      read: () => JSON.stringify(event()),
      append,
      out
    };
    main(['record'], io);
    expect(append).toHaveBeenCalledExactlyOnceWith('output', `release_sha=${SHA}\n`);
    main(['verify'], io);
    expect(append).toHaveBeenCalledTimes(1);
    expect(out.write).toHaveBeenCalledWith(`Release identity verified: ${TAG} ${SHA}\n`);
  });

  it('does not record or print identity on mismatch', () => {
    const append = vi.fn<(file: string, text: string) => void>();
    const out = { write: vi.fn<(text: string) => unknown>() };
    expect(() =>
      main(['record'], {
        env,
        read: () => JSON.stringify(event()),
        exec: executor({ tag: OTHER }),
        append,
        out
      })
    ).toThrow('remote tag identity mismatch');
    expect(append).not.toHaveBeenCalled();
    expect(out.write).not.toHaveBeenCalled();
  });

  it('sanitizes event and output failures', () => {
    expect(() =>
      main(['verify'], {
        env,
        read: () => {
          throw new Error('secret-canary');
        }
      })
    ).toThrow(/^CI event inaccessible$/);
    expect(() =>
      main(['record'], {
        env,
        read: () => JSON.stringify(event()),
        exec: executor(),
        append: () => {
          throw new Error('secret-canary');
        }
      })
    ).toThrow(/^release output inaccessible$/);
    expect(() => main(['unknown'])).toThrow('invalid guard command');
  });

  it('checks credential presence without commands, file access or printing values', () => {
    const credentials = {
      SUPABASE_ACCESS_TOKEN: 'secret-canary',
      SUPABASE_DB_PASSWORD: 'secret-canary',
      CLOUDFLARE_ACCOUNT_ID: 'secret-canary',
      CLOUDFLARE_API_TOKEN: 'secret-canary'
    };
    const exec = executor();
    const read = vi.fn<(file: string | undefined, encoding: 'utf8') => string>();
    const out = { write: vi.fn<(text: string) => unknown>() };
    main(['credentials'], { env: credentials, exec, read, out });
    expect(exec).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(out.write).not.toHaveBeenCalled();
    for (const name of Object.keys(credentials)) {
      expect(() => assertCredentials({ ...credentials, [name]: ' ' })).toThrow(
        `missing credential: ${name}`
      );
    }
  });
});
