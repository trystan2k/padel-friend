import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MATCH_REGISTRATION_SQL_SOURCE = readFileSync(
  new URL('./match-registration-sql.ts', import.meta.url),
  'utf8'
);
const FIXTURE_CLEANUP_SOURCE = readFileSync(
  new URL('./fixture-cleanup.ts', import.meta.url),
  'utf8'
);

describe('match fixture trigger-state cleanup', () => {
  it('captures trigger state after table locks and restores within the cleanup batch', () => {
    // A true competing-DDL race is nondeterministic in serial integration tests.
    // Keep the structural transaction boundary explicit: the capture is inserted
    // after table locks and before disables, and cleanup executes all statements
    // through one batch transaction on one PostgreSQL client.
    expect(MATCH_REGISTRATION_SQL_SOURCE).toContain(
      'beforeStatements.unshift(\n        ...lockedTables.map((table) => `lock table public.${table} in access exclusive mode`)'
    );
    expect(MATCH_REGISTRATION_SQL_SOURCE).toContain(
      'beforeStatements.splice(\n        lockedTables.length,\n        0,\n        `create temporary table paf_fixture_trigger_states'
    );
    expect(MATCH_REGISTRATION_SQL_SOURCE).toContain('from pg_temp.paf_fixture_trigger_states s');
    expect(FIXTURE_CLEANUP_SOURCE).toContain(
      'await executeTrustedSqlBatch(statements.map((sql) => ({ sql })))'
    );
  });
});
