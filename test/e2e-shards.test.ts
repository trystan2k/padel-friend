import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEIGHT_SECONDS,
  FUNCTIONAL_LANES,
  RATING_LOCK_SPECS,
  SERIAL_SPECS,
  SPEC_WEIGHTS,
  VISUAL_GREP,
  gateLanes,
  isVisualFile,
  repoRelativeSpec,
  laneArgs,
  listSpecs,
  planGroups
} from '../scripts/e2e-shards.mjs';

const specs = listSpecs();
const functional = specs.filter((spec) => !isVisualFile(spec));

describe('listSpecs', () => {
  it('discovers specs recursively, like Playwright, and ignores other files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-specs-'));
    try {
      mkdirSync(path.join(root, 'nested/deeper'), { recursive: true });
      for (const file of [
        'a.spec.ts',
        'helper.ts',
        'nested/b.spec.ts',
        'nested/deeper/c.spec.ts'
      ]) {
        writeFileSync(path.join(root, file), '');
      }
      expect(listSpecs(root)).toEqual([
        `${root}/a.spec.ts`,
        `${root}/nested/b.spec.ts`,
        `${root}/nested/deeper/c.spec.ts`
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('repoRelativeSpec', () => {
  it('computes repo-relative paths, including nested specs, without assuming a common prefix', () => {
    expect(repoRelativeSpec('/abs/repo/e2e', '/abs/repo/e2e/home.spec.ts')).toBe(
      'e2e/home.spec.ts'
    );
    expect(repoRelativeSpec('/abs/repo/e2e', '/abs/repo/e2e/nested/deeper/c.spec.ts')).toBe(
      'e2e/nested/deeper/c.spec.ts'
    );
    expect(repoRelativeSpec('/abs/repo/e2e/', '/abs/repo/e2e/a.spec.ts')).toBe('e2e/a.spec.ts');
  });
});

describe('E2E functional lanes', () => {
  it('assigns every functional spec to exactly one lane', () => {
    const assigned = planGroups(specs).flatMap((group) => group.specs);
    const serial = specs.filter((spec) => SERIAL_SPECS.includes(spec));
    expect(serial).toEqual(SERIAL_SPECS);
    const functionalSerial = serial.filter((spec) => !isVisualFile(spec));
    expect([...assigned, ...functionalSerial].sort((a, b) => a.localeCompare(b))).toEqual(
      functional
    );
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('never schedules standalone visual specs in a functional lane', () => {
    for (const group of planGroups(specs)) expect(group.specs.filter(isVisualFile)).toEqual([]);
  });

  it('has weights for existing functional specs only', () => {
    const lanes = functional.filter((spec) => !SERIAL_SPECS.includes(spec));
    expect(Object.keys(SPEC_WEIGHTS).sort((a, b) => a.localeCompare(b))).toEqual(lanes);
  });

  it('never co-locates two rating-suite-lock specs in one functional lane', () => {
    for (const group of planGroups(specs))
      expect(group.specs.filter((spec) => RATING_LOCK_SPECS.includes(spec)).length).toBeLessThan(2);
  });

  it('has rating-suite-lock specs that exist', () => {
    for (const spec of RATING_LOCK_SPECS) expect(specs).toContain(spec);
  });

  it('balances lanes within 15% of the heaviest', () => {
    const seconds = planGroups(specs).map((group) => group.seconds);
    expect((Math.max(...seconds) - Math.min(...seconds)) / Math.max(...seconds)).toBeLessThan(0.15);
  });

  it('is deterministic and gives unknown specs a conservative weight', () => {
    expect(planGroups(specs)).toEqual(planGroups([...specs].reverse()));
    const withNew = planGroups([...specs, 'e2e/brand-new.spec.ts']);
    const lane = withNew.find((group) => group.specs.includes('e2e/brand-new.spec.ts'));
    expect(lane).toBeDefined();
    expect(DEFAULT_WEIGHT_SECONDS).toBeGreaterThan(0);
  });

  it('builds lane args: explicit specs with the inverse visual filter, or the visual filter alone', () => {
    for (let lane = 1; lane <= FUNCTIONAL_LANES; lane++) {
      const args = laneArgs(`functional-${lane}`, specs);
      expect(args.slice(-2)).toEqual(['--grep-invert', VISUAL_GREP]);
      expect(args.slice(0, -2).every((arg) => arg.endsWith('.spec.ts'))).toBe(true);
    }
    const nonSerial = specs.filter((spec) => !SERIAL_SPECS.includes(spec));
    expect(laneArgs('visual', specs)).toEqual([...nonSerial, '--grep', VISUAL_GREP]);
    expect(laneArgs('serial', specs)).toEqual(SERIAL_SPECS);
    expect(SERIAL_SPECS).toHaveLength(7);
    expect(SERIAL_SPECS).not.toContain('e2e/level-reviews-visual.spec.ts');
    expect(gateLanes().serial).toEqual(SERIAL_SPECS);
    expect(() => laneArgs('functional-9', specs)).toThrow('Unknown E2E lane');
  });
});

describe('serial lane precedence', () => {
  it('lets serial win over visual: a serial visual spec runs only in the serial lane, whole', () => {
    const serialVisual = SERIAL_SPECS.filter(isVisualFile);
    expect(serialVisual).toEqual(['e2e/result-corrections-visual.spec.ts']);
    const serialArgs = laneArgs('serial', specs);
    const visualArgs = laneArgs('visual', specs);
    for (const spec of serialVisual) {
      expect(serialArgs).toContain(spec);
      expect(serialArgs).not.toContain('--grep-invert');
      expect(visualArgs).not.toContain(spec);
    }
    // Every serial spec is selected by exactly one lane.
    const lanes = [
      ...Array.from({ length: FUNCTIONAL_LANES }, (_, index) => 'functional-' + String(index + 1)),
      'serial',
      'visual'
    ].map((lane) => laneArgs(lane, specs).filter((arg) => arg.endsWith('.spec.ts')));
    for (const spec of SERIAL_SPECS) {
      expect(lanes.filter((lane) => lane.includes(spec))).toHaveLength(1);
    }
  });
});

describe('visual classification', () => {
  const regex = new RegExp(VISUAL_GREP);

  it('matches every standalone visual spec path and the @visual tag', () => {
    for (const spec of specs.filter(isVisualFile)) expect(regex.test(spec)).toBe(true);
    expect(regex.test('some test @visual')).toBe(true);
    expect(regex.test('e2e/home.spec.ts')).toBe(false);
  });

  it('tags every functional spec that owns a baseline pixel comparison', () => {
    const untagged = functional.filter((spec) => {
      const source = readFileSync(spec, 'utf8');
      return /toHaveScreenshot\(|\bvisualDiff\(/.test(source) && !source.includes("'@visual'");
    });
    expect(untagged).toEqual([]);
  });
});

describe('playwright config', () => {
  async function configFor(
    ci: string | undefined,
    prebuilt?: string,
    prebuiltKey = 'E2E_GATE_PREBUILT'
  ) {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        throw new Error('no local stack');
      }
    }));
    const previousCi = process.env.CI;
    const previousPrebuilt = process.env[prebuiltKey];
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('CI', ci);
    restore(prebuiltKey, prebuilt);
    try {
      return (await import('../playwright.config')).default;
    } finally {
      restore('CI', previousCi);
      restore(prebuiltKey, previousPrebuilt);
      vi.doUnmock('node:child_process');
    }
  }

  it('uses 4 workers on CI and the Playwright default locally', async () => {
    expect((await configFor('1')).workers).toBe(4);
    expect((await configFor(undefined)).workers).toBeUndefined();
  });

  it('builds a fresh preview unless the CI-verified prebuilt flag is set, never reusing a server', async () => {
    expect((await configFor(undefined)).webServer).toMatchObject({
      command: 'pnpm build && pnpm preview --port 4173',
      reuseExistingServer: false
    });
    expect((await configFor('1', '1')).webServer).toMatchObject({
      command: 'pnpm preview --port 4173',
      reuseExistingServer: false
    });
  });

  it('ignores the legacy E2E_PREBUILT flag inherited from a shell', async () => {
    expect((await configFor(undefined, '1', 'E2E_PREBUILT')).webServer).toMatchObject({
      command: 'pnpm build && pnpm preview --port 4173'
    });
  });
});
