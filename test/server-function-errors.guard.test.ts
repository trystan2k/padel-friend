import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { scanServerFunctionErrors } from '../scripts/check-server-function-errors.mjs';

const scan = (file: string, text: string) => scanServerFunctionErrors([{ file, text }]);

describe('server-function error guard', () => {
  it('passes on the current source tree', () => {
    expect(() => execFileSync('node', ['scripts/check-server-function-errors.mjs'])).not.toThrow();
  });

  it.each([
    ['direct rethrow', 'if (error) throw error;'],
    ['member rethrow', 'if (a.error) throw a.error;'],
    ['alias rethrow', 'if (communityError) throw communityError;'],
    ['multiline rethrow', 'if (error)\n  throw\n    error;']
  ])('rejects a %s in a .functions.ts file', (_name, text) => {
    expect(scan('src/features/x/x.functions.ts', text)).toEqual([
      expect.objectContaining({ rule: 'raw-throw' })
    ]);
  });

  it('rejects raw rethrows in server helpers and reports the line', () => {
    expect(scan('src/features/x/x.server.ts', 'const a = 1;\nthrow error;')).toEqual([
      { file: 'src/features/x/x.server.ts', line: 2, rule: 'raw-throw' }
    ]);
  });

  it('rejects message passthrough and raw cause wrapping', () => {
    expect(scan('src/features/x/x.functions.ts', 'throw new Error(error.message);')).toEqual([
      expect.objectContaining({ rule: 'error-message-passthrough' })
    ]);
    expect(
      scan('src/features/x/x.functions.ts', "throw new Error('X', { cause: error });")
    ).toEqual([expect.objectContaining({ rule: 'raw-cause' })]);
  });

  it('rejects dynamic new Error arguments but accepts literals and the boundary file', () => {
    for (const text of [
      'throw new Error(code);',
      'throw new Error(mapper(error));',
      "throw new Error('X: ' + detail);",
      'throw new Error(`X ${detail}`);',
      'return new Error(\n  code,\n);'
    ])
      expect(scan('src/lib/x.server.ts', text)).toEqual([
        expect.objectContaining({ rule: 'dynamic-error' })
      ]);
    expect(
      scan('src/lib/x.server.ts', "throw new Error('CODE');\nthrow new Error(`CODE`);")
    ).toEqual([]);
    expect(scan('src/lib/client-error.server.ts', 'return new Error(code);')).toEqual([]);
  });

  it('allows dynamic errors only with an inline guard-allow annotation', () => {
    expect(
      scan(
        'src/lib/x.server.ts',
        '// guard-allow: dynamic-error — closed union\nthrow new Error(code);'
      )
    ).toEqual([]);
    expect(
      scan('src/lib/x.server.ts', '// guard-allow: cause — wrong tag\nthrow new Error(code);')
    ).toEqual([expect.objectContaining({ rule: 'dynamic-error' })]);
    expect(
      scan('src/lib/x.server.ts', '// guard-allow: dynamic-error\n\n\nthrow new Error(code);')
    ).toEqual([expect.objectContaining({ rule: 'dynamic-error' })]);
  });

  it('rejects cause wrapping in .server.ts unless annotated', () => {
    const text = "throw new Error('X', { cause: error });";
    expect(scan('src/features/x/x.server.ts', text)).toEqual([
      expect.objectContaining({ rule: 'raw-cause' })
    ]);
    expect(
      scan('src/features/x/x.server.ts', '// guard-allow: cause — cron only\n' + text)
    ).toEqual([]);
  });

  it('scans server modules outside src/features', () => {
    expect(scan('src/lib/x.server.ts', 'throw error;')).toEqual([
      expect.objectContaining({ rule: 'raw-throw' })
    ]);
    expect(scan('src/i18n/x.functions.ts', 'throw error;')).toEqual([
      expect.objectContaining({ rule: 'raw-throw' })
    ]);
    expect(
      scan('src/lib/x.server.ts', '// guard-allow: raw-throw — mapped upstream\nthrow error;')
    ).toEqual([]);
  });

  it('rejects explicit rejected-promise helpers', () => {
    expect(scan('src/lib/x.server.ts', 'return Promise.reject(error);')).toEqual([
      expect.objectContaining({ rule: 'promise-reject' })
    ]);
    expect(scan('src/lib/x.server.ts', 'new Promise((_, reject) => reject(error));')).toEqual([
      expect.objectContaining({ rule: 'promise-reject' })
    ]);
    expect(scan('src/lib/x.server.ts', 'return Promise.reject(toClientError(error));')).toEqual([
      expect.objectContaining({ rule: 'promise-reject' })
    ]);
  });

  it.each([
    ['new Object wrapper', 'new Promise((_, reject) => reject(new Object(error)));'],
    [
      'identifier indirection',
      'const wrapped = error;\nnew Promise((_, reject) => reject(wrapped));'
    ],
    ['call result', 'new Promise((_, reject) => reject(build(error)));'],
    ['multiline wrapper', 'new Promise((_, reject) =>\n  reject(\n    new Object(error),\n  ));']
  ])('rejects a rejection through %s', (_name, text) => {
    expect(scan('src/lib/x.server.ts', text)).toEqual([
      expect.objectContaining({ rule: 'promise-reject' })
    ]);
  });

  it('accepts rejection with a fresh literal error or a mapped error', () => {
    expect(
      scan(
        'src/lib/x.server.ts',
        "new Promise((_, reject) => reject(new Error('CODE')));\nnew Promise((_, reject) => reject(toClientError(error)));"
      )
    ).toEqual([]);
  });

  it('counts guard-allow only as a well-formed line comment with a reason', () => {
    const throwing = 'throw new Error(code);';
    for (const text of [
      `const s = '// guard-allow: dynamic-error forged';\n${throwing}`,
      `const s = \`// guard-allow: dynamic-error forged\`;\n${throwing}`,
      `const guardAllowDynamicError = 1; // guard-allowed: dynamic-error x\n${throwing}`,
      `/* guard-allow: dynamic-error block */\n${throwing}`,
      `// guard-allow: dynamic-error\n${throwing}`,
      `// guard-allow: dynamic-errors reason\n${throwing}`,
      `// see guard-allow: dynamic-error reason\n${throwing}`,
      `const s = 'x'; throw new Error(code + '// guard-allow: dynamic-error reason');`
    ])
      expect(scan('src/lib/x.server.ts', text)).toEqual([
        expect.objectContaining({ rule: 'dynamic-error' })
      ]);
    for (const text of [
      `// guard-allow: dynamic-error — closed union\n${throwing}`,
      `${throwing} // guard-allow: dynamic-error closed union`,
      `const s = 'a // b'; // guard-allow: dynamic-error closed union\n${throwing}`,
      `const s = \`\${a}\`; // guard-allow: dynamic-error closed union\n${throwing}`
    ])
      expect(scan('src/lib/x.server.ts', text)).toEqual([]);
  });

  it('accepts mapped and fresh errors, comments and unrelated files', () => {
    expect(
      scan(
        'src/features/x/x.functions.ts',
        "if (error) throw toClientError(error);\nthrow new Error('CODE');\n// throw error;\n/* throw error; */"
      )
    ).toEqual([]);
    expect(scan('src/features/x/X.tsx', 'throw error;')).toEqual([]);
  });
});

describe('F24/F25 guard hardening', () => {
  it.each([
    ['assignment on a fresh error', "reject(new Error('X').cause = raw);"],
    ['plain member assignment', "const e = new Error('X');\ne.cause = raw;"],
    ['bracket assignment', "e['cause'] = raw;"],
    ['spaced assignment', 'e . cause\n  = raw;'],
    ['Object.assign cause', 'Object.assign(e, { cause: raw });'],
    ['non-leading cause property', "throw new Error('X', { a: 1, cause: raw });"]
  ])('flags cause mutation via %s', (_name, text) => {
    const findings = scan('src/lib/x.server.ts', text);
    expect(findings.map((finding) => finding.rule)).toContain('raw-cause');
  });

  it('allows cause mutation only with a tagged comment, and ignores comparisons', () => {
    expect(
      scan('src/lib/x.server.ts', '// guard-allow: cause — cron only\ne.cause = raw;')
    ).toEqual([]);
    expect(scan('src/lib/x.server.ts', 'if (e.cause === raw) log();\nconst c = e.cause;')).toEqual(
      []
    );
  });

  it.each([
    ['escaped slash', 'const r = /foo\\/">//;\nthrow error;'],
    ['escaped slash then flags', 'const r = /a\\/b/gi;\nthrow error;'],
    ['slash in character class', 'const r = /[/]x\\//;\nthrow error;'],
    ['regex after return', 'function f() { return /\\//.test(s); }\nthrow error;'],
    ['regex as argument', 'x.replace(/\\/\\//g, "");\nthrow error;'],
    ['division after paren', 'const a = (b) / 2; const c = d / 3;\nthrow error;'],
    ['division after identifier', 'const a = b / c / d;\nthrow error;']
  ])('keeps scanning after a %s and detects the throw', (_name, text) => {
    expect(scan('src/lib/x.server.ts', text)).toEqual([
      { file: 'src/lib/x.server.ts', line: 2, rule: 'raw-throw' }
    ]);
  });

  it('does not report throw-like text inside regex literals', () => {
    expect(scan('src/lib/x.server.ts', 'const r = /throw error;/;')).toEqual([]);
  });

  it('keeps a trailing guard-allow comment after a regex literal', () => {
    expect(
      scan(
        'src/lib/x.server.ts',
        'const r = /a\\//; // guard-allow: dynamic-error closed union\nthrow new Error(code);'
      )
    ).toEqual([]);
  });
});
