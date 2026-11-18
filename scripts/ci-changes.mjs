import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Change-set classifier for the CI path gate (see the `changes` job in .github/workflows/ci.yml).
//
// A documentation-only change set cannot affect the build, the database or the browser bundle, so
// CI runs only the aggregate check plus the format lane. Everything else is CODE: the gate fails
// closed, so a new directory runs full CI until it is classified here on purpose.
//
// Documentation-only patterns are inert by construction:
//   - .agents/**, .opencode/**: agent instructions; ignored by oxlint/oxfmt/knip, read by no script.
//   - .serena/**: agent project config; oxfmt formatting still runs in the docs-only lane.
//   - docs/**: plans, development logs, PRDs, runbooks, visual evidence; no runtime or test reader.
//   - *.md (repository root only): prose; oxfmt formatting still runs in the docs-only lane.
//   - remaining root metadata files below: read by no script, test or build step.
//
// Always-code patterns only look like documentation; they are test inputs. Skipping CI for them
// would hide a real regression:
//   - docs/design/**: Pencil source whose bytes are sha256-pinned by unit visual-reference tests
//     and hashed by three E2E visual specs.
//   - docs/rating/**: approved rating oracle read by unit tests.
//   - INITIAL_SETUP.md: pinned by test/isolation-proof-product-fixtures.test.ts.
export const DOC_ONLY_PATTERNS = [
  '.agents/**',
  '.opencode/**',
  '.serena/**',
  'docs/**',
  '*.md',
  'skills.txt',
  'skills-lock.json',
  'opencode.jsonc',
  '.linear.toml',
  '.editorconfig',
  '.env.example',
  '.dev.vars.example'
];

export const ALWAYS_CODE_PATTERNS = ['docs/design/**', 'docs/rating/**', 'INITIAL_SETUP.md'];

// Release-please opens its release PR from this branch (see release-please-config.json). That PR only
// bumps the version and writes the changelog: the push to main that produced it already ran full CI
// on the same code, and release.yml waits for that run before tagging. So the PR runs static only.
export const RELEASE_PR_BRANCH_PREFIX = 'release-please--branches--main';
export const RELEASE_PR_FILES = ['.release-please-manifest.json', 'CHANGELOG.md', 'package.json'];

/** Matches an exact path, a `dir/**` subtree, or a repository-root `*.ext` suffix. */
export function matchesPattern(file, pattern) {
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3);
    return file === dir || file.startsWith(dir + '/');
  }
  if (pattern.startsWith('*.')) return !file.includes('/') && file.endsWith(pattern.slice(1));
  return file === pattern;
}

/** Strips whitespace, one git quoting pair and any leading `./`. */
export function normalizePath(raw) {
  const trimmed = raw.trim();
  const unquoted =
    trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/^(\.\/)+/, '');
}

/** Splits `git diff -z` output, falling back to newline-separated input. */
export function splitChangedPaths(text) {
  return text.includes('\0') ? text.split('\0') : text.split('\n');
}

export function isCodePath(file) {
  if (ALWAYS_CODE_PATTERNS.some((pattern) => matchesPattern(file, pattern))) return true;
  return !DOC_ONLY_PATTERNS.some((pattern) => matchesPattern(file, pattern));
}

/**
 * Only a release-please branch from this repository counts. Fork pull requests can name their branch
 * anything, so the head repository must be the base repository.
 */
export function isReleasePr({ headRef = '', headRepo = '', baseRepo = '' } = {}) {
  return headRef.startsWith(RELEASE_PR_BRANCH_PREFIX) && headRepo !== '' && headRepo === baseRepo;
}

/**
 * Verdict per change set: `code` (full CI), `release` (static lane only) or `docs` (format lane only).
 */
export function classify(paths, context = {}) {
  const files = [...new Set(paths.map(normalizePath).filter(Boolean))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  const codeFiles = files.filter(isCodePath);
  const docFiles = files.filter((file) => !isCodePath(file));
  let mode = 'code';
  // An empty diff is not evidence that nothing changed: run full CI.
  if (
    files.length > 0 &&
    isReleasePr(context) &&
    files.every((file) => RELEASE_PR_FILES.includes(file))
  ) {
    mode = 'release';
  } else if (files.length > 0 && codeFiles.length === 0) {
    mode = 'docs';
  }
  return { mode, codeFiles, docFiles };
}

export function main(argv = [], io = {}) {
  if (argv.length > 0) {
    throw new Error(
      'Usage: node scripts/ci-changes.mjs  (changed paths on stdin, NUL- or newline-separated)'
    );
  }
  const env = io.env ?? process.env;
  const result = classify(splitChangedPaths(io.stdin ?? readFileSync(0, 'utf8')), {
    headRef: env.PR_HEAD_REF ?? '',
    headRepo: env.PR_HEAD_REPO ?? '',
    baseRepo: env.BASE_REPO ?? ''
  });
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  if (result.codeFiles.length === 0 && result.docFiles.length === 0) {
    err.write('[ci-changes] no changed paths reported; running full CI\n');
  }
  err.write(
    '[ci-changes] mode=' +
      result.mode +
      ' codeFiles=' +
      result.codeFiles.length +
      ' docFiles=' +
      result.docFiles.length +
      '\n'
  );
  if (result.codeFiles.length > 0) {
    const shown = result.codeFiles.slice(0, 10).join(', ');
    const extra = result.codeFiles.length > 10 ? ' (+' + (result.codeFiles.length - 10) + ')' : '';
    err.write('[ci-changes] code inputs: ' + shown + extra + '\n');
  }
  out.write(result.mode + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      '[ci-changes] ' + (error instanceof Error ? error.message : 'failed') + '\n'
    );
    process.exit(1);
  }
}
