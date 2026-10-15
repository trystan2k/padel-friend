import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateTypes } from '../scripts/db-types.mjs';

const directories: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-types-test-'));
  directories.push(dir);
  await writeFile(
    path.join(dir, '.oxfmtrc.json'),
    JSON.stringify({
      overrides: [
        {
          files: ['src/lib/supabase/database.types.ts'],
          options: { semi: false, singleQuote: false, trailingComma: 'all' }
        }
      ]
    })
  );
  const destination = path.join(dir, 'database.types.ts');
  await writeFile(destination, 'original');
  return { dir, destination };
}
afterEach(async () =>
  Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
);

describe('database type generation', () => {
  it('preserves destination and cleans scratch when generator fails after partial stdout', async () => {
    const f = await fixture();
    await expect(
      generateTypes({
        rootDir: f.dir,
        destinationPath: f.destination,
        runProcess: async (_cmd, args) =>
          args[0] === 'exec' && args[1] === 'supabase'
            ? { code: 1, signal: null, stdout: 'partial', stderr: 'failed' }
            : { code: 0, signal: null, stdout: '', stderr: '' }
      })
    ).rejects.toThrow('Type generation failed');
    expect(await readFile(f.destination, 'utf8')).toBe('original');
    expect(await (await import('node:fs/promises')).readdir(f.dir)).toEqual([
      '.oxfmtrc.json',
      'database.types.ts'
    ]);
  });

  it.each([
    ['empty output', { code: 0, signal: null, stdout: '', stderr: '' }],
    [
      'signal failure',
      { code: null, signal: 'SIGTERM' as NodeJS.Signals, stdout: 'partial', stderr: '' }
    ]
  ])('preserves destination on %s', async (_label, result) => {
    const f = await fixture();
    await expect(
      generateTypes({
        rootDir: f.dir,
        destinationPath: f.destination,
        runProcess: async () => result
      })
    ).rejects.toThrow('Type generation');
    expect(await readFile(f.destination, 'utf8')).toBe('original');
  });

  it('does not replace destination when formatting fails', async () => {
    const f = await fixture();
    await expect(
      generateTypes({
        rootDir: f.dir,
        destinationPath: f.destination,
        runProcess: async (_cmd, args) =>
          args.includes('--local')
            ? { code: 0, signal: null, stdout: 'export type DB = {}\n', stderr: '' }
            : { code: 2, signal: null, stdout: '', stderr: 'format error' }
      })
    ).rejects.toThrow('Type formatting failed');
    expect(await readFile(f.destination, 'utf8')).toBe('original');
  });

  it('formats then atomically replaces destination; repeated output is stable', async () => {
    const f = await fixture();
    const runProcess = async (_cmd: string, args: string[]) => {
      if (args.includes('--local'))
        return {
          code: 0,
          signal: null,
          stdout: 'export type DB = {\n x: string;\n};\n',
          stderr: ''
        };
      const candidate = args.at(-1)!;
      await writeFile(candidate, 'export type DB = { x: string }\n');
      return { code: 0, signal: null, stdout: '', stderr: '' };
    };
    await generateTypes({ rootDir: f.dir, destinationPath: f.destination, runProcess });
    expect(await readFile(f.destination, 'utf8')).toBe('export type DB = { x: string }\n');
    const first = await readFile(f.destination);
    await generateTypes({ rootDir: f.dir, destinationPath: f.destination, runProcess });
    expect(await readFile(f.destination)).toEqual(first);
  });

  it('checks equality and reports drift without mutating destination', async () => {
    const f = await fixture();
    await writeFile(f.destination, 'normalized\n');
    const runProcess = async (_cmd: string, args: string[]) => {
      if (args.includes('--local')) return { code: 0, signal: null, stdout: 'raw', stderr: '' };
      await writeFile(args.at(-1)!, 'normalized\n');
      return { code: 0, signal: null, stdout: '', stderr: '' };
    };
    await generateTypes({
      check: true,
      rootDir: f.dir,
      destinationPath: f.destination,
      runProcess
    });
    await writeFile(f.destination, 'different');
    await expect(
      generateTypes({ check: true, rootDir: f.dir, destinationPath: f.destination, runProcess })
    ).rejects.toThrow('Run pnpm db:types');
    expect(await readFile(f.destination, 'utf8')).toBe('different');
  });
});
