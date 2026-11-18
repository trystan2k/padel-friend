import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_CODE_PATTERNS,
  DOC_ONLY_PATTERNS,
  classify,
  isCodePath,
  main,
  matchesPattern,
  normalizePath,
  splitChangedPaths
} from '../scripts/ci-changes.mjs';

// Which change sets may skip the build, the database and the browser suites. Getting this wrong in
// the "code" direction wastes CI minutes; getting it wrong in the "documentation" direction hides a
// real regression, so every entry below is an explicit, reviewed decision.
const cases: Array<[string, boolean]> = [
  // Application, build, data and tooling inputs: full CI.
  ['src/routes/index.tsx', true],
  ['src/i18n/config.ts', true],
  ['supabase/migrations/20260101000000_init.sql', true],
  ['supabase/config.toml', true],
  ['design-tokens/tokens/color.json', true],
  ['public/icons/icon-192.png', true],
  ['e2e/home.spec.ts', true],
  ['e2e/references/paf-4/home-desktop.png', true],
  ['test/ci-changes.test.ts', true],
  ['test/fixtures/push-worker/worker.ts', true],
  ['scripts/ci-changes.mjs', true],
  ['package.json', true],
  ['pnpm-lock.yaml', true],
  ['pnpm-workspace.yaml', true],
  ['wrangler.jsonc', true],
  ['vite.config.ts', true],
  ['integration-partition.ts', true],
  ['.github/workflows/ci.yml', true],
  ['.github/actions/supabase-start/action.yml', true],
  ['.husky/pre-commit', true],
  ['.lintstagedrc.json', true],
  ['.oxfmtrc.json', true],
  ['.env', true],
  // Unknown paths fail closed: a new directory or a new non-markdown root file runs full CI.
  ['NEW_DIRECTORY/notes.md', true],
  ['new-tool.config.mjs', true],
  // Prose and agent configuration that nothing reads at runtime.
  ['AGENTS.md', false],
  ['ARCHITECTURE.md', false],
  ['README.md', false],
  ['CHANGELOG.md', false],
  ['CONTRIBUTING.md', false],
  ['docs/plan/Plan PAF-1 — Authenticate and onboard an app-wide player.md', false],
  ['docs/development-logs/Task PAF-109 reduce test runtime.md', false],
  ['docs/production-release-runbook.md', false],
  ['docs/visual/community-admin-residuals.md', false],
  ['docs/harness/README.md', false],
  ['.agents/skills/base-ui/SKILL.md', false],
  ['.opencode/agents/git-specialist.md', false],
  ['.opencode/commands/release-preflight.md', false],
  ['.serena/project.yml', false],
  ['skills-lock.json', false],
  ['skills.txt', false],
  // Documentation that is really a test input: never skipped.
  ['docs/design/padel-friend.pen', true],
  ['docs/design/icon-exports/pwa-icon-512.png', true],
  ['docs/rating/golden-fixtures.json', true],
  ['INITIAL_SETUP.md', true]
];

const SCAN_DIRS = ['src', 'test', 'e2e', 'scripts'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const READ_REFERENCE = /readFileSync\(\s*new URL\(\s*['"]([^'"]+)['"]/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SCAN_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

describe('CI change classification', () => {
  it.each(cases)('%s needs full CI: %s', (file, needsCode) => {
    expect(isCodePath(file)).toBe(needsCode);
  });

  it('runs full CI when any changed path is code', () => {
    expect(classify(['README.md', 'src/app.tsx']).code).toBe(true);
    expect(classify(['README.md', 'docs/plan/x.md']).code).toBe(false);
    expect(classify(['docs/plan/x.md', 'docs/design/padel-friend.pen']).code).toBe(true);
  });

  it('treats an empty or unreadable change set as code', () => {
    expect(classify([])).toEqual({ code: true, codeFiles: [], docFiles: [] });
    expect(classify(['', '  ', '\n'])).toEqual({ code: true, codeFiles: [], docFiles: [] });
  });

  it('reports both sides of a mixed change set', () => {
    expect(classify(['README.md', './src/app.tsx', 'README.md'])).toEqual({
      code: true,
      codeFiles: ['src/app.tsx'],
      docFiles: ['README.md']
    });
  });

  it('keeps every test-pinned pattern inside a documentation subtree it overrides', () => {
    for (const pattern of ALWAYS_CODE_PATTERNS) {
      const sample = pattern.endsWith('/**') ? pattern.replace('/**', '/sample') : pattern;
      expect(matchesPattern(sample, pattern)).toBe(true);
      expect(isCodePath(sample)).toBe(true);
    }
    expect(ALWAYS_CODE_PATTERNS.some((pattern) => pattern.startsWith('docs/'))).toBe(true);
    expect(DOC_ONLY_PATTERNS).toContain('docs/**');
  });

  it('classifies every repository file a test or spec reads as code', () => {
    const repoRoot = process.cwd();
    const referenced = new Set<string>();
    for (const file of SCAN_DIRS.flatMap(walk)) {
      for (const match of readFileSync(file, 'utf8').matchAll(READ_REFERENCE)) {
        const spec = match[1];
        if (!spec) continue;
        const resolved = path.resolve(path.dirname(file), spec);
        const relative = path.relative(repoRoot, resolved);
        if (relative.startsWith('..') || !existsSync(resolved)) continue;
        referenced.add(relative.split(path.sep).join('/'));
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    // A test or spec that starts reading a documentation file must be classified as code, or the
    // gate would skip the very suite that guards it.
    expect([...referenced].filter((file) => !isCodePath(file))).toEqual([]);
  });
});

describe('CI change classification input handling', () => {
  it('normalizes whitespace, one git quoting pair and leading ./, segments', () => {
    expect(normalizePath('  docs/plan/x.md  ')).toBe('docs/plan/x.md');
    expect(normalizePath('"docs/plan/x.md"')).toBe('docs/plan/x.md');
    expect(normalizePath('././src/app.tsx')).toBe('src/app.tsx');
  });

  it('splits NUL-separated and newline-separated diffs', () => {
    expect(splitChangedPaths('a\0b\0')).toEqual(['a', 'b', '']);
    expect(splitChangedPaths('a\nb\n')).toEqual(['a', 'b', '']);
  });

  it('writes only the verdict to stdout and the reason to stderr', () => {
    let stdout = '';
    let stderr = '';
    const io = {
      stdin: 'docs/plan/x.md\0',
      out: { write: (text: string) => (stdout += text) },
      err: { write: (text: string) => (stderr += text) }
    };
    expect(main([], io).code).toBe(false);
    expect(stdout).toBe('false\n');
    expect(stderr).toContain('[ci-changes] code=false');
    expect(stderr).not.toContain('code inputs');
  });

  it('names the code inputs and flags an empty diff', () => {
    let stdout = '';
    let stderr = '';
    main([], {
      stdin: 'src/a.ts\0src/b.ts\0',
      out: { write: (text: string) => (stdout += text) },
      err: { write: (text: string) => (stderr += text) }
    });
    expect(stdout).toBe('true\n');
    expect(stderr).toContain('code inputs: src/a.ts, src/b.ts');
    stderr = '';
    main([], {
      stdin: '',
      out: { write: (text: string) => (stdout += text) },
      err: { write: (text: string) => (stderr += text) }
    });
    expect(stderr).toContain('no changed paths reported');
  });

  it('rejects positional arguments', () => {
    expect(() => main(['--code'])).toThrow(/Usage/);
  });
});
