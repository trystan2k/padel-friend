import { describe, expect, it, vi } from 'vitest';
import type { NoticeOptions } from '../scripts/production-release-notice.mjs';
import {
  buildNoticeBody,
  buildNoticeSummary,
  postNotice
} from '../scripts/production-release-notice.mjs';

const TAG = 'v1.2.3';

describe('production release notice', () => {
  it('appends the notice block once, preserving the changelog body', () => {
    const original = '## [1.2.3](compare)\n\n### Features\n\n* thing ([abc](commit))\n';
    const first = buildNoticeBody(original, TAG);
    expect(first.changed).toBe(true);
    expect(first.body.startsWith(original)).toBe(true);
    expect(first.body).toContain('/release-preflight ' + TAG);
    expect(first.body).toContain('docs/production-release-runbook.md');
    expect(first.body).toContain('release-preflight-notice');

    const second = buildNoticeBody(first.body, TAG);
    expect(second).toEqual({ body: first.body, changed: false });
  });

  it('never emits a line the migration marker parser would read as an Approved-pending marker', () => {
    const { body } = buildNoticeBody('changelog\n', TAG);
    const markerLines = body.split('\n').filter((line) => /^Approved-pending:[ \t]/.test(line));
    expect(markerLines).toEqual([]);
  });

  it('handles an empty body without a leading separator', () => {
    const { body } = buildNoticeBody('', TAG);
    expect(body.startsWith('<!-- release-preflight-notice -->')).toBe(true);
  });

  it('writes the run summary pointing at the tag', () => {
    const summaryText = buildNoticeSummary(TAG);
    expect(summaryText).toContain('`/release-preflight ' + TAG + '`');
    expect(summaryText).toContain('production-release-runbook.md');
  });

  it('posts the patched body and summary without exposing the token', async () => {
    const release = { id: 42, body: 'changelog' };
    const calls: Array<{ path: string; init?: Record<string, unknown> }> = [];
    const fetchMock = vi.fn<NonNullable<NoticeOptions['fetch']>>(async (path, init) => {
      calls.push({ path, init });
      return {
        ok: true,
        status: 200,
        json: async () => release
      };
    });
    const out = { write: vi.fn<(text: string) => void>() };
    const summary = { write: vi.fn<(text: string) => void>() };
    await postNotice({
      env: { RELEASE_TAG: TAG, GITHUB_REPOSITORY: 'acme/app', GITHUB_TOKEN: 'secret-token' },
      fetch: fetchMock,
      out,
      summary
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.path).toBe('https://api.github.com/repos/acme/app/releases/tags/v1.2.3');
    expect(calls[1]!.path).toBe('https://api.github.com/repos/acme/app/releases/42');
    const patchBody = JSON.parse(String(calls[1]!.init!.body));
    expect(patchBody.body).toContain('release-preflight-notice');
    expect(patchBody.body).toContain('changelog');
    // The token rides in the Authorization header by necessity; it must never surface in
    // user-visible output (stdout lines, summaries) or the patched body.
    const visible =
      JSON.stringify(patchBody.body) +
      JSON.stringify(out.write.mock.calls) +
      JSON.stringify(summary.write.mock.calls);
    expect(visible).not.toContain('secret-token');
    expect(out.write.mock.calls.some(([line]) => line.includes('appended'))).toBe(true);
    expect(summary.write).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a tag, repository, or token', async () => {
    const fetchMock = vi.fn<NonNullable<NoticeOptions['fetch']>>();
    await expect(
      postNotice({ env: {}, fetch: fetchMock, out: { write: vi.fn<(text: string) => void>() } })
    ).rejects.toThrow('RELEASE_TAG missing');
    await expect(
      postNotice({
        env: { RELEASE_TAG: TAG },
        fetch: fetchMock,
        out: { write: vi.fn<(text: string) => void>() }
      })
    ).rejects.toThrow('GITHUB_REPOSITORY missing');
    await expect(
      postNotice({
        env: { RELEASE_TAG: TAG, GITHUB_REPOSITORY: 'acme/app' },
        fetch: fetchMock,
        out: { write: vi.fn<(text: string) => void>() }
      })
    ).rejects.toThrow('GITHUB_TOKEN missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails on a failed release lookup', async () => {
    const fetchMock = vi.fn<NonNullable<NoticeOptions['fetch']>>(async () => ({
      ok: false,
      status: 404,
      json: async () => ({})
    }));
    await expect(
      postNotice({
        env: { RELEASE_TAG: TAG, GITHUB_REPOSITORY: 'acme/app', GITHUB_TOKEN: 't' },
        fetch: fetchMock,
        out: { write: vi.fn<(text: string) => void>() }
      })
    ).rejects.toThrow('release lookup failed (404)');
  });
});
