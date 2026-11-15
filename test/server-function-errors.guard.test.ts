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
