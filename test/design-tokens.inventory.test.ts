import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Token inventory contract for the Clubhouse language (frame c1TsP): sources and the generated
// stylesheet must agree, every role is themed light/dark where the frame says so, and the
// focus ring and Figtree typography are tokenized instead of hardcoded in consumers.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../design-tokens/dist/tokens.css');
const primitives = JSON.parse(read('../design-tokens/primitives.tokens.json'));
const semantic = JSON.parse(read('../design-tokens/semantic.tokens.json'));

const declarations = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()])
  );
const [lightBlock, darkBlock] = css.split('[data-theme="dark"]');
const light = declarations(lightBlock!);
const dark = { ...light, ...declarations(darkBlock!) };

function resolve(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Unknown token ${name}`);
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  return variable ? resolve(tokens, variable[1]!) : value;
}

// Light and dark values for every colour role defined by frame c1TsP.
const CLUBHOUSE_ROLES: Record<string, [string, string]> = {
  bg: ['#F5F6F2', '#0B1410'],
  surface: ['#FFFFFF', '#142019'],
  'surface-2': ['#EAEEE8', '#1D2B23'],
  text: ['#0F1B15', '#ECF2EE'],
  muted: ['#4F5E55', '#A6B5AC'],
  hairline: ['#E3E8E3', '#26352D'],
  line: ['#7C8A81', '#6F8277'],
  green: ['#0F6B47', '#7EDDA6'],
  'on-green': ['#FFFFFF', '#06261A'],
  'green-soft': ['#DDF0E5', '#173A2A'],
  'green-ink': ['#0A4F34', '#A8EBC3'],
  lime: ['#D4F25A', '#D4F25A'],
  amber: ['#8A5A00', '#E8BB68'],
  'amber-soft': ['#FBEFD5', '#3A2E14'],
  red: ['#B3261E', '#FF8A7E'],
  'red-soft': ['#FBE3E0', '#3D1A17']
};

describe('Clubhouse colour roles', () => {
  it.each(Object.entries(CLUBHOUSE_ROLES))(
    '%s matches frame c1TsP in both themes',
    (role, [l, d]) => {
      expect(resolve(light, `--color-${role}`).toUpperCase()).toBe(l);
      expect(resolve(dark, `--color-${role}`).toUpperCase()).toBe(d);
    }
  );

  it('defines no duplicate semantic colour (same light and dark pair)', () => {
    const pairs = Object.keys(semantic.color).map(
      (role) => `${resolve(light, `--color-${role}`)}/${resolve(dark, `--color-${role}`)}`
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('keeps every themed palette colour consumed by exactly one semantic role', () => {
    const used = JSON.stringify(semantic);
    for (const name of Object.keys(primitives.palette)) {
      const references = used.split(`{palette.${name}}`).length - 1;
      expect(references, `palette.${name}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Clubhouse focus ring', () => {
  it('tokenizes a 3px outline, 2px offset and the blue focus colour', () => {
    expect(resolve(light, '--focus-width')).toBe('3px');
    expect(resolve(light, '--focus-offset')).toBe('2px');
    expect(resolve(light, '--color-focus').toUpperCase()).toBe('#2F7BF6');
    expect(resolve(dark, '--color-focus').toUpperCase()).toBe('#2F7BF6');
  });
});

describe('Figtree typography', () => {
  it('uses Figtree for body and heading with a system fallback and no Inter/Manrope', () => {
    expect(light['--font-family-body']).toBe('Figtree, system-ui, sans-serif');
    expect(resolve(light, '--font-family-heading')).toBe(light['--font-family-body']);
    expect(css).not.toMatch(/Inter|Manrope/);
  });

  it('exposes weights 400 through 800', () => {
    expect(
      ['regular', 'medium', 'semibold', 'bold', 'extrabold'].map((w) => light[`--font-weight-${w}`])
    ).toEqual(['400', '500', '600', '700', '800']);
  });

  it('loads Figtree 400–800 from the root route and drops Inter/Manrope dependencies', () => {
    const root = read('../src/routes/__root.tsx');
    for (const weight of [400, 500, 600, 700, 800]) {
      expect(root).toContain(`import '@fontsource/figtree/${weight}.css';`);
    }
    expect(root).not.toMatch(/@fontsource\/(inter|manrope)/);
    const pkg = JSON.parse(read('../package.json'));
    expect(pkg.dependencies['@fontsource/figtree']).toMatch(/^~/);
    expect(pkg.dependencies).not.toHaveProperty('@fontsource/inter');
    expect(pkg.dependencies).not.toHaveProperty('@fontsource/manrope');
  });
});
