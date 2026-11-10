import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './local-supabase-env';
import { executeTrustedSql, queryTrustedSql } from './sql-transport';
import {
  communityMemberGuard,
  matchEventImmutable,
  triggerStatePreservingSql,
  withTriggersDisabled
} from './trigger-state-sql';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const stateSql = (table: string, trigger: string) => `select t.tgenabled::text as state
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = '${table}' and t.tgname = '${trigger}'`;

async function stateOf(table: string, trigger: string) {
  const state = (await queryTrustedSql(stateSql(table, trigger))).rows[0]?.['state'];
  if (typeof state !== 'string') throw new Error(`${table}.${trigger} not found`);
  return state;
}

const alterSql: Record<string, string> = {
  O: 'enable trigger',
  A: 'enable always trigger',
  R: 'enable replica trigger',
  D: 'disable trigger'
};

async function setState(table: string, trigger: string, state: string) {
  await executeTrustedSql(`alter table public.${table} ${alterSql[state]} ${trigger}`);
}

const assertDisabledSql = (table: string, trigger: string) => `
  if (${stateSql(table, trigger)}) <> 'D' then raise exception 'trigger not disabled during work'; end if;`;

describe.skipIf(environment.env === null)('trigger state preserving DDL helper', () => {
  for (const original of ['O', 'A', 'R', 'D']) {
    it(`restores a ${original} trigger exactly after disabling it for the work`, async () => {
      const first = await stateOf('community_members', 'community_member_guard');
      try {
        await setState('community_members', 'community_member_guard', original);
        await withTriggersDisabled(
          [communityMemberGuard],
          assertDisabledSql('community_members', 'community_member_guard')
        );
        expect(await stateOf('community_members', 'community_member_guard')).toBe(original);
      } finally {
        await setState('community_members', 'community_member_guard', first);
      }
    });
  }

  it('restores each trigger of a multi-trigger call to its own original state', async () => {
    const guardFirst = await stateOf('community_members', 'community_member_guard');
    const immutableFirst = await stateOf('match_events', 'match_event_immutable');
    try {
      await setState('community_members', 'community_member_guard', 'A');
      await setState('match_events', 'match_event_immutable', 'R');
      await withTriggersDisabled(
        [communityMemberGuard, matchEventImmutable, matchEventImmutable],
        [
          assertDisabledSql('community_members', 'community_member_guard'),
          assertDisabledSql('match_events', 'match_event_immutable')
        ]
      );
      expect(await stateOf('community_members', 'community_member_guard')).toBe('A');
      expect(await stateOf('match_events', 'match_event_immutable')).toBe('R');
    } finally {
      await setState('community_members', 'community_member_guard', guardFirst);
      await setState('match_events', 'match_event_immutable', immutableFirst);
    }
  });

  it('rolls back the disable and leaves the original state when the work fails', async () => {
    const first = await stateOf('community_members', 'community_member_guard');
    try {
      await setState('community_members', 'community_member_guard', 'A');
      await expect(withTriggersDisabled([communityMemberGuard], 'perform 1 / 0;')).rejects.toThrow(
        /division by zero/
      );
      expect(await stateOf('community_members', 'community_member_guard')).toBe('A');
    } finally {
      await setState('community_members', 'community_member_guard', first);
    }
  });

  it('rejects a missing trigger without changing any other trigger', async () => {
    const first = await stateOf('community_members', 'community_member_guard');
    try {
      await setState('community_members', 'community_member_guard', 'R');
      await expect(
        withTriggersDisabled(
          [communityMemberGuard, { table: 'community_members', trigger: 'no_such_trigger' }],
          'perform 1;'
        )
      ).rejects.toThrow(/expected triggers are missing: expected 2, found 1/);
      expect(await stateOf('community_members', 'community_member_guard')).toBe('R');
    } finally {
      await setState('community_members', 'community_member_guard', first);
    }
  });
});

describe('triggerStatePreservingSql input validation', () => {
  it('rejects unsafe identifiers and empty trigger lists', () => {
    expect(() =>
      triggerStatePreservingSql([{ table: 'x; drop table y', trigger: 't' }], 'perform 1;')
    ).toThrow(/Invalid trigger reference/);
    expect(() => triggerStatePreservingSql([], 'perform 1;')).toThrow(
      /At least one trigger is required/
    );
  });
});
