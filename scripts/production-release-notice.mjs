import { pathToFileURL } from 'node:url';

// Marker comment used for idempotency; never rendered.
const NOTICE_MARKER = '<!-- release-preflight-notice -->';

// Reviewer notice appended to freshly created releases. It must never contain a line starting
// with `Approved-pending:` — scripts/production-migrations.mjs parses that line out of the body,
// and an extra occurrence would fail the approval stage as ambiguous.
function noticeBlock(tag) {
  return [
    NOTICE_MARKER,
    '> [!WARNING]',
    '> **Production approver: before approving this release, run the preflight review.**',
    '>',
    '> 1. Run the OpenCode command `/release-preflight ' + tag + '` — it executes the read-only',
    '>    production preflight (`docs/production-release-runbook.md` §5), shows every pending',
    '>    migration SQL with the compatibility checklist, and records the reviewed pending set in',
    '>    this release body as the required marker (§2) after your explicit approval.',
    '> 2. Approving without that step fails the deploy closed at the `approval` stage.',
    '> 3. After the marker lands, re-run the failed deploy job and grant a fresh `production`',
    '>    environment approval; approval never carries over between runs.'
  ].join('\n');
}

// Pure body transform: returns the body with exactly one notice block appended.
export function buildNoticeBody(body, tag) {
  const base = typeof body === 'string' ? body : '';
  if (base.includes(NOTICE_MARKER)) return { body: base, changed: false };
  const separator = base.trim().length === 0 ? '' : '\n\n';
  return { body: base + separator + noticeBlock(tag) + '\n', changed: true };
}

// Summary block for the GitHub Actions run page.
export function buildNoticeSummary(tag) {
  return [
    '## Release reviewer checklist',
    '',
    'Release `' + tag + '` was created. Before approving the `production` environment:',
    '',
    '1. Run the OpenCode command `/release-preflight ' + tag + '` (read-only preflight + marker).',
    '2. Then re-run the failed deploy job if one exists and grant a **fresh** approval.',
    '',
    'Checklist: `docs/production-release-runbook.md` §2.'
  ].join('\n');
}

export async function postNotice({ env, fetch, out, summary }) {
  const tag = env.RELEASE_TAG;
  if (!tag) throw new Error('release notice: RELEASE_TAG missing');
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) throw new Error('release notice: GITHUB_REPOSITORY missing');
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('release notice: GITHUB_TOKEN missing');

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
  const request = (path, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    return fetch('https://api.github.com' + path, {
      ...options,
      headers,
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
  };

  const response = await request(
    '/repos/' + repository + '/releases/tags/' + encodeURIComponent(tag)
  );
  if (!response.ok)
    throw new Error('release notice: release lookup failed (' + response.status + ')');
  const release = await response.json();
  const { body, changed } = buildNoticeBody(release.body, tag);
  if (!changed) {
    out.write('release notice: already present; body unchanged\n');
  } else {
    const patch = await request('/repos/' + repository + '/releases/' + release.id, {
      method: 'PATCH',
      body: JSON.stringify({ body })
    });
    if (!patch.ok) throw new Error('release notice: body update failed (' + patch.status + ')');
    out.write('release notice: appended to ' + tag + '\n');
  }
  if (summary) summary.write(buildNoticeSummary(tag) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.stdout;
  const summary = process.env.GITHUB_STEP_SUMMARY
    ? (await import('node:fs')).createWriteStream(process.env.GITHUB_STEP_SUMMARY)
    : null;
  try {
    await postNotice({ env: process.env, fetch: globalThis.fetch, out, summary });
  } catch (error) {
    out.write((error && error.message ? error.message : 'release notice failed') + '\n');
    process.exitCode = 1;
  } finally {
    if (summary) summary.end();
  }
}
