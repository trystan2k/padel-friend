import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEIGHT_SECONDS,
  FUNCTIONAL_LANES,
  SERIAL_SPECS,
  SPEC_WEIGHTS,
  VISUAL_GREP,
  isVisualFile,
  laneArgs,
  listSpecs,
  planGroups
} from '../scripts/e2e-shards.mjs';

const specs = listSpecs();
const functional = specs.filter((spec) => !isVisualFile(spec));

describe('E2E functional lanes', () => {
  it('assigns every functional spec to exactly one lane', () => {
    const assigned = planGroups(specs).flatMap((group) => group.specs);
    const serial = specs.filter((spec) => SERIAL_SPECS.includes(spec));
    expect(serial).toEqual(SERIAL_SPECS);
    expect([...assigned, ...serial].sort((a, b) => a.localeCompare(b))).toEqual(functional);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('never schedules standalone visual specs in a functional lane', () => {
    for (const group of planGroups(specs)) expect(group.specs.filter(isVisualFile)).toEqual([]);
  });

  it('has weights for existing functional specs only', () => {
    const lanes = functional.filter((spec) => !SERIAL_SPECS.includes(spec));
    expect(Object.keys(SPEC_WEIGHTS).sort((a, b) => a.localeCompare(b))).toEqual(lanes);
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
    expect(laneArgs('visual', specs)).toEqual(['--grep', VISUAL_GREP]);
    expect(laneArgs('serial', specs)).toEqual([...SERIAL_SPECS, '--grep-invert', VISUAL_GREP]);
    expect(() => laneArgs('functional-9', specs)).toThrow('Unknown E2E lane');
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
  async function configFor(ci: string | undefined, prebuilt?: string) {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        throw new Error('no local stack');
      }
    }));
    const previousCi = process.env.CI;
    const previousPrebuilt = process.env.E2E_PREBUILT;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('CI', ci);
    restore('E2E_PREBUILT', prebuilt);
    try {
      return (await import('../playwright.config')).default;
    } finally {
      restore('CI', previousCi);
      restore('E2E_PREBUILT', previousPrebuilt);
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
});
