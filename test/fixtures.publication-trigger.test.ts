import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SourceRecord {
  path: string;
  source: string;
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const helperPath = 'test/helpers/match-photo-fixtures.ts';
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.sql']);

function findViolations(source: string): boolean {
  const trigger = ['lock_match_photo', '_publication'].join('');
  const commentsRemoved = source.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ');
  const separator = String.raw`(?:\s|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$))*`;
  const qualifiedToggle = new RegExp(
    String.raw`\bALTER${separator}TABLE${separator}[\s\S]*?${separator}(?:DISABLE|ENABLE)${separator}(?:(?:ALWAYS|REPLICA)${separator})?TRIGGER${separator}["']?${trigger}\b`,
    'i'
  );
  const blanketToggle = new RegExp(
    String.raw`\bALTER${separator}TABLE${separator}[\s\S]*?${separator}(?:DISABLE|ENABLE)${separator}(?:(?:ALWAYS|REPLICA)${separator})?TRIGGER${separator}(?:ALL|USER)\b`,
    'i'
  );
  const roleAssignment = new RegExp(
    String.raw`(?:\bSET${separator}session_replication_role${separator}(?:=|TO)${separator}[^;]+|\bset_config${separator}\(${separator}'session_replication_role'${separator},)`,
    'i'
  );
  return (
    qualifiedToggle.test(source) ||
    blanketToggle.test(source) ||
    roleAssignment.test(commentsRemoved)
  );
}

function assertSourcesSafe(sources: SourceRecord[]): void {
  const offendingPaths = sources
    .filter(({ source }) => findViolations(source))
    .map(({ path }) => path);
  if (offendingPaths.length > 0)
    throw new Error(
      `Forbidden publication-trigger operation in: ${offendingPaths.join(', ')}. Use ${helperPath} to seed valid photo fixtures.`
    );
}

function walkTestSources(directory: string, relativeDirectory = 'test'): SourceRecord[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .flatMap((entry) => {
      const path = `${relativeDirectory}/${entry.name}`;
      const absolutePath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return walkTestSources(absolutePath, path);
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      return extensions.has(extension)
        ? [{ path, source: readFileSync(absolutePath, 'utf8') }]
        : [];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

describe('publication trigger fixture guard', () => {
  it('rejects unsafe SQL forms and accepts safe fixture source', () => {
    const target = ['lock_match_photo', '_publication'].join('');
    const violations = [
      ['ALTER TABLE storage.objects ', 'DISABLE TRIGGER ', target].join(''),
      ['ALTER TABLE storage.objects ', 'ENABLE TRIGGER ', `'${target}'`].join(''),
      ['ALTER TABLE storage.objects ', 'ENABLE ALWAYS TRIGGER ', target].join(''),
      ['ALTER TABLE storage.objects ', 'ENABLE REPLICA TRIGGER ', `"${target}"`].join(''),
      ['alter table storage.objects ', 'disable trigger ', target].join(''),
      [
        'ALTER /* step */ TABLE storage.objects -- table\n ',
        'DISABLE TRIGGER ',
        `'${target}'`
      ].join(''),
      ['ALTER TABLE storage.objects ', 'DISABLE TRIGGER ', 'ALL'].join(''),
      ['ALTER TABLE storage.objects ', 'ENABLE TRIGGER ', 'USER'].join(''),
      ['SET ', 'session_replication_role', " = 'replica'"].join(''),
      ["SELECT set_config('", 'session_replication_role', "', 'replica', true)"].join('')
    ];
    const synthetic = violations.map((source, index) => ({
      path: `synthetic-${index}.sql`,
      source
    }));
    expect(() => assertSourcesSafe(synthetic)).toThrow(/synthetic-0\.sql/);
    expect(() => assertSourcesSafe(synthetic)).toThrow(helperPath);
    expect(() =>
      assertSourcesSafe([{ path: helperPath, source: `/** documentation mentions ${target} */` }])
    ).not.toThrow();
    expect(() =>
      assertSourcesSafe([
        { path: 'safe.sql', source: 'ALTER TABLE storage.objects ENABLE TRIGGER other_trigger;' }
      ])
    ).not.toThrow();
  });

  it('finds no unsafe publication-trigger operations in test sources', () => {
    expect(() => assertSourcesSafe(walkTestSources(`${repositoryRoot}test`))).not.toThrow();
  });
});
