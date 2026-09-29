import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Cascade contract of the global stylesheet. This invariant regressed once into every form
// control rendering at the UA-default typography (an unlayered font declaration beat the
// StyleX layered typography), so three structural guarantees are pinned at the source level:
// the explicit layer order must stay the very first statement, the form-control font
// inheritance must live inside `@layer reset`, and no unlayered rule may declare font
// metrics or a font family on form controls. The scanner walks the stylesheet depth- and
// at-rule-aware: rules nested inside `@media`/`@supports` stay inspected (they are equally
// unlayered) and the universal selector counts as targeting the controls. Scanning masks
// comments and quoted strings in one quote/escape-aware pass, so declaration-like text and
// comment markers inside strings never skew the verdict. A separate test pins the same
// order on the BUILT bundle, because the production build may drop the explicit order
// statement and leave the effective cascade to emission order alone.

const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const LAYER_ORDER_STATEMENT = '@layer reset, priority1, priority2, priority3, priority4;';
const FORM_CONTROLS = ['button', 'input', 'select', 'textarea'] as const;

// Type tokens plus the universal selector: `main > button:focus`, `input[type=email]` or a
// bare `*` target the controls, while `.icon-button`, `select2` or `textarea-wrapper` do not.
const FORM_CONTROL_SELECTOR = new RegExp(
  `(^|[\\s>+~,(])(?:${FORM_CONTROLS.join('|')}|\\*)(?=$|[\\s.#[>~+:,)])`
);
// `font:` (shorthand), `font-size`, `font-weight`, `line-height` and `font-family` all
// override what the layered StyleX typography assigns to the controls. A custom property
// like `--font-size` does not (its leading `-` fails the boundary requirement below).
const FONT_METRIC_DECLARATION =
  /(^|[;{\s])(?:font-family|font-size|font-weight|font|line-height)\s*:/;
const FORM_CONTROL_INHERITANCE_RULE =
  /button\s*,\s*input\s*,\s*select\s*,\s*textarea\s*\{[^{}]*\bfont\s*:\s*inherit\s*;/;

type CssRule = { kind: 'rule'; header: string; body: string };
type CssNode = CssRule | { kind: 'statement'; text: string };

/** Index just past the quoted string opening at `openQuoteIndex`; honors backslash escapes. */
function skipString(source: string, openQuoteIndex: number): number {
  const quote = source[openQuoteIndex];
  for (let index = openQuoteIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === quote) return index + 1;
  }
  return source.length;
}

/**
 * Single quote/escape-aware pass masking CSS comments and quoted strings: every masked
 * character becomes a space, so offsets are preserved and no later scan can ever see text
 * inside a string or a comment. String and comment state is tracked together, which keeps
 * a comment marker inside a string string content (instead of a comment opener) and a
 * quote inside a comment comment content; unclosed constructs simply mask to the end.
 */
function maskCommentsAndStrings(source: string): string {
  const masked = source.split('');
  let index = 0;
  while (index < masked.length) {
    const char = masked[index];
    if (char === '"' || char === "'") {
      const end = skipString(source, index);
      for (let cursor = index; cursor < end; cursor += 1) masked[cursor] = ' ';
      index = end;
    } else if (char === '/' && masked[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close === -1 ? source.length : close + 2;
      for (let cursor = index; cursor < end; cursor += 1) {
        if (masked[cursor] !== '\n') masked[cursor] = ' ';
      }
      index = end;
    } else index += 1;
  }
  return masked.join('');
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'") index = skipString(source, index) - 1;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`unbalanced braces starting at index ${openIndex}`);
}

/**
 * Splits a stylesheet chunk into its immediate children: braced rules (with header and body)
 * and plain `...;` statements such as `@layer a, b;`, `@import ...;` or `@charset ...;`.
 * Terminating on `;` is what keeps an at-rule prelude from bleeding into the header of the
 * NEXT rule (a naive brace scanner glues `@layer ...;` / `@import ...;` onto the following
 * block header, which then looks "layered" and gets discarded whole). Quoted strings never
 * hide a structural `{`, `}` or `;`.
 */
function parseChunk(source: string): CssNode[] {
  const nodes: CssNode[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    let index = cursor;
    let structural = -1;
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") index = skipString(source, index);
      else if (char === '{' || char === ';') {
        structural = index;
        break;
      } else index += 1;
    }
    if (structural === -1) break; // only whitespace/trailing content remains
    if (source[structural] === ';') {
      const text = source.slice(cursor, structural).trim();
      if (text) nodes.push({ kind: 'statement', text });
      cursor = structural + 1;
      continue;
    }
    const close = matchingBrace(source, structural);
    nodes.push({
      kind: 'rule',
      header: source.slice(cursor, structural).trim(),
      body: source.slice(structural + 1, close)
    });
    cursor = close + 1;
  }
  return nodes;
}

// Conditional group rules contain ordinary style rules, which stay UNLAYERED (and therefore
// beat every StyleX layer) unless wrapped in an inner `@layer`. `@layer` blocks are layered
// outright, and other at-rule blocks (`@font-face`, `@keyframes`, `@property`, ...) carry no
// selector-level typography on the controls.
const CONDITIONAL_GROUP_RULE = /^@(media|supports|container|scope)\b/;

function unlayeredLeafRules(nodes: CssNode[]): CssRule[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'statement') return []; // `@layer a, b;` / `@import` / `@charset`
    if (/^@layer\b/.test(node.header)) return [];
    if (CONDITIONAL_GROUP_RULE.test(node.header)) return unlayeredLeafRules(parseChunk(node.body));
    if (node.header.startsWith('@')) return [];
    return [node];
  });
}

function unlayeredFontMetricOffenders(css: string): string[] {
  return unlayeredLeafRules(parseChunk(maskCommentsAndStrings(css)))
    .filter((rule) => FORM_CONTROL_SELECTOR.test(rule.header))
    .filter((rule) => FONT_METRIC_DECLARATION.test(rule.body))
    .map((rule) => rule.header);
}

const sourceNodes = parseChunk(maskCommentsAndStrings(stylesSource));

const layerBlocks = sourceNodes.flatMap((node) => {
  if (node.kind !== 'rule') return [];
  const name = /^@layer\s+([\w-]+)$/.exec(node.header)?.[1];
  return name ? [{ name, body: node.body }] : [];
});

describe('global stylesheet cascade contract', () => {
  it('declares the explicit layer order as the very first statement', () => {
    expect(
      maskCommentsAndStrings(stylesSource).trimStart().startsWith(LAYER_ORDER_STATEMENT),
      'the @layer order statement must be the first statement of the stylesheet, before every other rule, so the layered cascade priority is established first'
    ).toBe(true);
  });

  it('keeps the form-control font inheritance inside the reset layer', () => {
    const inheritedInsideReset = layerBlocks
      .filter((layer) => layer.name === 'reset')
      .some((layer) => FORM_CONTROL_INHERITANCE_RULE.test(layer.body));
    expect(
      inheritedInsideReset,
      'the button/input/select/textarea font:inherit rule must live inside @layer reset so the layered StyleX typography wins the cascade'
    ).toBe(true);
  });

  it('declares no unlayered font metrics on form controls', () => {
    const offenders = unlayeredFontMetricOffenders(stylesSource);
    expect(
      offenders,
      'unlayered rules must not set font metrics on form controls (including via the universal selector): they beat every StyleX layer and pin the controls to a hardcoded typography'
    ).toEqual([]);
  });
});

describe('unlayered-rule scanner mutation cases', () => {
  it('catches a font metric hidden in an @media block right after the layer statements', () => {
    // Regression guard: the previous scanner glued the `@layer ...;` / `@import ...;` preludes
    // onto the header of the next braced block, so an @media block that immediately followed
    // them was discarded whole as if it were layered and this offender passed silently.
    const css = [
      '@layer reset, priority1, priority2, priority3, priority4;',
      "@import url('./tokens.css');",
      '@media (min-width: 40em) {',
      '  button { font-size: 16px; }',
      '}'
    ].join('\n');
    expect(unlayeredFontMetricOffenders(css)).toEqual(['button']);
  });

  it('catches universal-selector rules pinning font metrics', () => {
    expect(unlayeredFontMetricOffenders('* { font-size: 16px; }')).toEqual(['*']);
    expect(unlayeredFontMetricOffenders('@media screen { * { line-height: 1.4; } }')).toEqual([
      '*'
    ]);
  });

  it('catches font metrics behind compound selectors on the controls', () => {
    expect(unlayeredFontMetricOffenders('main > button:focus { font: 16px sans-serif; }')).toEqual([
      'main > button:focus'
    ]);
    expect(unlayeredFontMetricOffenders('input[type=email] { font-weight: 600; }')).toEqual([
      'input[type=email]'
    ]);
  });

  it('does not flag layered equivalents or lookalike selectors', () => {
    expect(unlayeredFontMetricOffenders('@layer reset { button { font-size: 16px; } }')).toEqual(
      []
    );
    expect(unlayeredFontMetricOffenders('@layer reset { button { font-family: serif; } }')).toEqual(
      []
    );
    expect(
      unlayeredFontMetricOffenders('@media screen { @layer base { * { font-weight: 600; } } }')
    ).toEqual([]);
    expect(unlayeredFontMetricOffenders('.icon-button { font-size: 2rem; }')).toEqual([]);
    expect(unlayeredFontMetricOffenders('select2 { font-size: 1rem; }')).toEqual([]);
    expect(unlayeredFontMetricOffenders('[data-label="button"] { font-size: 1rem; }')).toEqual([]);
  });

  it('catches an unlayered font-family pinning the controls to a hardcoded typeface', () => {
    expect(unlayeredFontMetricOffenders('button { font-family: serif; }')).toEqual(['button']);
    expect(unlayeredFontMetricOffenders('input { font-family: monospace; }')).toEqual(['input']);
  });

  it('ignores declaration-like text inside quoted values', () => {
    expect(unlayeredFontMetricOffenders('button { --hint: "use font-size: 16px"; }')).toEqual([]);
    expect(
      unlayeredFontMetricOffenders('button { --hint: "font-size: 16px"; font-weight: 600; }')
    ).toEqual(['button']);
  });

  it('does not treat comment markers inside strings as comments', () => {
    // A string-unaware comment stripper splices from the `/*` inside the string to the next
    // `*/`, mangling the braces and hiding the real offender that follows the string.
    const css = 'button { content: "100% /*"; }\nbutton { font-size: 16px; }\n/* tail */';
    expect(unlayeredFontMetricOffenders(css)).toEqual(['button']);
  });

  it('ignores declaration-like text inside real comments', () => {
    expect(unlayeredFontMetricOffenders('button { /* font-size: 16px; */ }')).toEqual([]);
  });
});

// The source-level contract cannot guarantee the shipped CSS: the production build may drop
// the explicit `@layer` order statement (dedupe), leaving the effective cascade to emission
// order. Because the cascade priority of a layer is fixed by where it is FIRST established,
// the built stylesheet must emit the reset layer before any StyleX priority layer.
// A missing `dist/` means this is a standalone `pnpm test` before any build, so the bundle
// gate skips. But once build output exists, a missing assets dir or a stylesheet that no
// longer matches the `index-*.css` naming (an asset-naming change) must FAIL loudly: the
// alternative is a green suite that never tested the shipped cascade.
const BUNDLE_ROOT = new URL('../dist/', import.meta.url);
const BUNDLE_ASSETS_DIR = new URL('../dist/client/assets/', import.meta.url);
const BUNDLE_STYLESHEET_NAME = /^index-[\w-]+\.css$/;
const RESET_LAYER = /@layer reset\b/;
const PRIORITY_LAYER = /@layer priority1\b/;

function collectBundleStylesheets(): string[] {
  if (!existsSync(BUNDLE_ASSETS_DIR)) {
    throw new Error(
      '[styles.cascade] build output exists (dist/) but dist/client/assets/ is missing: refusing to pass the bundle-order gate without testing the shipped cascade'
    );
  }
  const entries = readdirSync(BUNDLE_ASSETS_DIR);
  const stylesheets = entries.filter((name) => BUNDLE_STYLESHEET_NAME.test(name)).sort();
  if (stylesheets.length === 0) {
    throw new Error(
      `[styles.cascade] dist/client/assets/ exists but contains no index-*.css stylesheet (contents: ${
        entries.join(', ') || 'none'
      }): refusing to pass the bundle-order gate without testing the shipped cascade`
    );
  }
  return stylesheets;
}

if (!existsSync(BUNDLE_ROOT)) {
  console.warn(
    '[styles.cascade] no dist/ build output found: bundle-order assertions are skipped here and only run under `pnpm complete-check`, which builds first'
  );
}

describe('production bundle cascade order', () => {
  it.skipIf(!existsSync(BUNDLE_ROOT))(
    'emits @layer reset before the StyleX priority layers in every built stylesheet',
    () => {
      for (const filename of collectBundleStylesheets()) {
        const css = readFileSync(
          new URL(`../dist/client/assets/${filename}`, import.meta.url),
          'utf8'
        );
        const resetIndex = css.search(RESET_LAYER);
        const priorityIndex = css.search(PRIORITY_LAYER);
        expect(
          resetIndex,
          `${filename} must still emit the @layer reset block`
        ).toBeGreaterThanOrEqual(0);
        expect(
          priorityIndex,
          `${filename} must still emit the StyleX priority layers`
        ).toBeGreaterThanOrEqual(0);
        expect(
          resetIndex < priorityIndex,
          `${filename} must establish @layer reset (index ${resetIndex}) before @layer priority1 (index ${priorityIndex}) so the StyleX typography layers beat the reset font:inherit`
        ).toBe(true);
      }
    }
  );
});
